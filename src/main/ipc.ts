import { ipcMain, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { nowLocalIso, todayLocalYmd } from '../shared/datetime';
import { log } from '../shared/logger';
import {
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  VOICE_STREAMING_ENABLED_ENV,
  TWO_TIER_ENABLED_ENV,
  COALESCE_ENABLED_ENV,
  VAD_PROVISIONAL_SILENCE_MS,
} from '../shared/constants';
import { appendShortTerm } from '../memory/short-term';
import { buildConversationMemory } from '../memory/context-builder';
import { requestExtraction, enforceShortTermCap } from '../memory/extraction-scheduler';
import { classifyTopicLocal } from '../router/local-classifier';
import { chat, makeLlmComplete, warmPromptCache, MODEL_SONNET, MODEL_HAIKU } from '../conversation/client';
import { chooseModelTier } from '../conversation/model-selector';
import { shouldPlayThinkingFiller } from '../conversation/thinking-filler';
import { correctNameMishear } from '../conversation/name-correction';
import { getSemantic } from '../memory/semantic';
import { executeOsCommand } from '../os/executor';
import { recordBirthdayCelebrated, recordConversationTurn } from '../character/active-character';
import { loadAnimationData } from '../character/animation-loader';
import { isApiKeyAvailable, encryptAndSaveApiKey } from '../storage/encryption';
import { saveWindowPosition, resetToDefaultPosition } from './window-position';
import { showCharacterContextMenu } from './character-context-menu';
import { handleApiAuthError } from './api-key-auto-recovery';
import { speakResponse, streamVoiceChat } from './voice-runtime';
import { VadRuntime, type CoalesceHooks } from './vad-runtime';
import { VoiceTurnCoordinator } from './voice-turn-coordinator';
import { BackchannelController } from './backchannel-controller';
import { transcribe, isSttModelAvailable } from '../conversation/stt-transcriber';
import type { CharacterContext } from '../shared/types/character';
import type { ConversationResponse } from '../shared/types/conversation';
import type { CharacterInfo } from '../shared/types/ipc';
import type { TranscribeResult } from '../shared/types/stt';
import type { EmotionLabel } from '../shared/types/animation';
import type { TtsEngine, VoiceConfig } from '../shared/types/voice';
import type { VoiceInputMode } from '../shared/types/settings';

// IPC ハンドラ集約(設計書 §4)。
// すべての業務ロジックは main 側。Renderer は IPC 経由でのみ呼ぶ(API キーも漏らさない)。

/** 起動時に構築され、ハンドラから参照される実行時状態。 */
export interface AppRuntime {
  charContext: CharacterContext | null;
  apiKey: string | null;
  /** 起動挨拶(Renderer が getInitialGreeting で1回取得する)。 */
  initialGreeting: string | null;
  /** 音声合成エンジン(task_17 Phase A・未起動/未設定なら null=テキストのみ)。 */
  tts: TtsEngine | null;
  /** 音声設定(emotion→スタイル/パラメータ・null なら音声無効)。 */
  voiceConfig: VoiceConfig | null;
  /** マイク入力方式(push-to-talk / hands-free・設定で切替・task_17 Phase C)。 */
  voiceInputMode: VoiceInputMode;
  /** 起動準備(音声エンジンのヘルス到達＋埋め込みウォーム)が整ったか。renderer の「ちょっと待って」解除に使う。 */
  ready: boolean;
  /** 思考フィラー(「うーん…」)を鳴らす(熟考時・B-15連動)。registerIpcHandlers が backchannel から配線。 */
  playThinkingFiller?: () => void;
}

const NOT_READY: ConversationResponse = {
  type: 'chat',
  message: '…ちょっと待ってね、まだ準備ができてないみたい。',
};

// ドラッグ中の move-window で位置保存を毎フレーム書かないようデバウンスする。
const POSITION_SAVE_DEBOUNCE_MS = 400;
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSavePosition(x: number, y: number): void {
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    void saveWindowPosition(x, y);
  }, POSITION_SAVE_DEBOUNCE_MS);
}

/** portrait.png を data URL 化する(CSP 準拠で Renderer に渡すため)。 */
async function readPortraitDataUrl(portraitPath: string): Promise<string> {
  try {
    const buf = await fs.readFile(portraitPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

const ERROR_RESPONSE: ConversationResponse = {
  type: 'chat',
  message: '…ごめん、なんか調子悪いみたい。もう一回試してみて?',
};

/** テキスト経路など「中断しない」呼び出し用の never-abort シグナル。 */
const NEVER_ABORT = new AbortController();
const NOOP = (): void => {};

/**
 * 応答を**生成**する(副作用なし=投機実行・中断に耐える)。記憶構築・ローカル判別・モデル選択・生成のみ。
 * 記憶書き込み等の副作用は commitTurn(生成完了かつ非キャンセル時)で行う=投機が捨てられても短期記憶を汚さない。
 *  - signal: 中断(コアレッシングの投機キャンセル)。abort されたら例外を投げて上位に破棄させる。
 *  - onFirstAudio: 第一声(=コミット点)の通知。
 *  - opts.playFiller: 思考フィラーを鳴らすか(投機経路では false=コミット前のちらつき回避)。
 */
async function generateResponse(
  text: string,
  runtime: AppRuntime,
  mainWindow: BrowserWindow,
  signal: AbortSignal,
  onFirstAudio: () => void,
  opts: { playFiller: boolean },
): Promise<{ response: ConversationResponse; audioStreamed: boolean } | null> {
  const { charContext, apiKey } = runtime;
  if (!charContext || !apiKey) return null;

  const onAuthError = (error: unknown): void => {
    void handleApiAuthError(error, mainWindow, (key) => {
      runtime.apiKey = key;
    });
  };

  const t0 = performance.now();
  // 記憶コンテキスト構築(全件横断想起・心/開示バイアス)＋ローカル判別(B-15・ネットワーク0往復)。
  //   query 埋め込みは直後の判別と共有(B-14a)。失敗は medium に倒し会話を止めない。
  const memoryContext = await buildConversationMemory({ text, limit: 5 });
  const routerResult = await classifyTopicLocal(text, charContext.knowledgeDomains);
  const tMem1 = performance.now();

  // 二段生成(B-15b・既定オフ ENE_TWO_TIER=1): 雑談=Haiku/難題=Sonnet。迷ったら Sonnet。
  const twoTier = process.env[TWO_TIER_ENABLED_ENV] === '1';
  const tier = twoTier ? chooseModelTier(routerResult, text) : 'sonnet';
  const model = tier === 'haiku' ? MODEL_HAIKU : MODEL_SONNET;

  // 思考フィラー(設計憲法・問いの性質で判定)。投機経路では出さない(コミット前のちらつき回避・opts.playFiller)。
  if (opts.playFiller && shouldPlayThinkingFiller(routerResult, text)) runtime.playThinkingFiller?.();

  // 本会話。音声＋ストリーミング ON(ENE_VOICE_STREAMING=1)なら文単位で第一声を早める(B-06)。失敗時は非ストリーミングへ。
  const { tts, voiceConfig } = runtime;
  const streamingOn =
    Boolean(tts && voiceConfig) && process.env[VOICE_STREAMING_ENABLED_ENV] === '1';
  let response: ConversationResponse;
  let audioStreamed = false;
  if (streamingOn && tts && voiceConfig) {
    try {
      response = await streamVoiceChat(
        text, charContext, memoryContext, routerResult, apiKey, model, tts, voiceConfig, mainWindow,
        signal, onFirstAudio,
      );
      audioStreamed = true; // ストリーミング中に音声は送出済み
    } catch (e) {
      if (signal.aborted) throw e; // 中断は破棄のため上位(coordinator)へ伝える(フォールバックしない)
      log.warn('voice streaming failed; falling back to non-streaming', { name: (e as Error).name });
      response = await chat(text, charContext, memoryContext, routerResult, apiKey, { onAuthError }, model);
    }
  } else {
    response = await chat(text, charContext, memoryContext, routerResult, apiKey, { onAuthError }, model);
  }

  // 計測ログ(ms のみ・§6.2)。total=生成全体 / mem+router=記憶＋判別 / response=Claude 往復。
  log.info(
    `turn latency: total=${Math.round(performance.now() - t0)}ms ` +
      `mem+router=${Math.round(tMem1 - t0)}ms response=${Math.round(performance.now() - tMem1)}ms` +
      (streamingOn ? ' (streaming)' : '') +
      (twoTier ? ` model=${tier}` : ''),
  );
  return { response, audioStreamed };
}

/**
 * 確定(コミット)。副作用=記憶書き込み/OSコマンド実行/誕生日記録/非ストリーミング発話。
 * **生成完了かつ非キャンセル時のみ**呼ぶ(投機が捨てられたら呼ばない=短期記憶を汚さない)。
 */
async function commitTurn(
  text: string,
  response: ConversationResponse,
  audioStreamed: boolean,
  runtime: AppRuntime,
  mainWindow: BrowserWindow,
): Promise<ConversationResponse> {
  const speakOut = (spokenText: string, emo: EmotionLabel): void => {
    const { tts, voiceConfig } = runtime;
    if (tts && voiceConfig) void speakResponse(spokenText, emo, tts, voiceConfig, mainWindow);
  };

  // 1. user を短期記憶へ ＋ 関係の事実を記録(ターンが確定したら=コミット時・task_16)。
  await appendShortTerm({ role: 'user', text, timestamp: nowLocalIso(), extracted: false });
  await recordConversationTurn();

  // 5. assistant を短期記憶へ
  await appendShortTerm({ role: 'assistant', text: response.message, timestamp: nowLocalIso(), extracted: false });

  // 5b/5c. 短期上限の死守＋記憶抽出(背景・await しない)。apiKey はコミット時点で存在する。
  const { apiKey } = runtime;
  if (apiKey) {
    await enforceShortTermCap(makeLlmComplete(apiKey));
    requestExtraction(makeLlmComplete(apiKey));
  }

  // 6. OS コマンドなら実行(失敗時はキャラ口調フォールバックに差し替え＋エラー発話)。
  if (response.type === 'os_command') {
    const osResult = await executeOsCommand(response.command);
    if (!osResult.ok && osResult.message) {
      speakOut(osResult.message, 'neutral');
      return { type: 'chat', message: osResult.message };
    }
  }

  // 7. 誕生日当日に「おめでとう」等で触れられたら、祝われた事実を記録(設計書 §3.1 / §5.4)。
  if (runtime.charContext?.birthdayHint === 'today') {
    const congrats = ['誕生日', 'おめでとう', 'ハッピーバースデー', 'Happy Birthday', 'バースデー'];
    if (congrats.some((w) => text.includes(w))) {
      await recordBirthdayCelebrated(todayLocalYmd().year);
    }
  }

  // 8. 非ストリーミング経路のみ、ここで確定応答を喋る(ストリーミングは送出済み・読みはルビ解決済)。
  if (!audioStreamed) {
    const emo: EmotionLabel = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
    speakOut(response.reading ?? response.message, emo);
  }
  return response;
}

// send-message の統合フロー(テキスト入力／非コアレッシングの音声経路・設計書 §4.2 / task_07 §7)。
// 生成→コミットを直列に行う(中断なし)。コアレッシング音声経路は VoiceTurnCoordinator が別途駆動する。
async function handleSendMessage(
  text: string,
  runtime: AppRuntime,
  mainWindow: BrowserWindow,
): Promise<ConversationResponse> {
  if (!runtime.charContext || !runtime.apiKey) return NOT_READY;
  const gen = await generateResponse(text, runtime, mainWindow, NEVER_ABORT.signal, NOOP, { playFiller: true });
  if (!gen) return NOT_READY;
  return commitTurn(text, gen.response, gen.audioStreamed, runtime, mainWindow);
}

export function registerIpcHandlers(mainWindow: BrowserWindow, runtime: AppRuntime): void {
  // 相槌コントローラ(task_18 Phase B)。tts/voiceConfig は起動順の都合で遅延参照する。
  // best-effort: 音声無効なら相槌は出ない(会話は成立)。
  const backchannel = new BackchannelController({
    characterId: runtime.charContext?.identity.characterId ?? 'ene',
    getTts: () => runtime.tts,
    getVoiceConfig: () => runtime.voiceConfig,
    send: (wav) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('ene:backchannel', wav);
    },
    sendFillerText: (text) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('ene:thinking-filler', text);
    },
    rng: Math.random,
  });
  // 思考フィラーを runtime 経由で handleSendMessage から呼べるよう配線(B-15連動)。
  // テキスト入力でも鳴らせるよう事前合成を先に試みる(best-effort・TTS 起動後に整う)。
  runtime.playThinkingFiller = () => backchannel.playThinkingFiller();
  void backchannel.prepare();

  // ハンズフリー VAD(task_17 Phase C)。renderer から連続フレームを受け、発話区間を
  // 文字起こしして確定テキストを renderer へ返す(renderer はそれを send-message に流す)。
  // ENE_LISTEN_ONLY=1: 相槌テスト用に応答(Claude/記憶=レイテンシ源)を止め、VAD＋相槌だけ動かす(task_18)。
  const listenOnly = process.env['ENE_LISTEN_ONLY'] === '1';
  // STT 確定テキストの名前誤認補正(発話全体が名前エイリアスのときだけ自称へ・B-10 Part4)。
  // identity は charContext からその都度読む(エイリアス/自称はキャラ依存値・§4.5)。STT 経路のみ。
  const correctTranscript = (text: string): string => {
    const id = runtime.charContext?.identity;
    return id ? correctNameMishear(text, id.sttAliases ?? [], id.selfRecognition.callsSelf) : text;
  };

  // コアレッシング(段階①・ENE_COALESCE=1): 投機生成＋連結。既定オフ=従来の renderer 駆動経路。
  //   暫定ターン終了(短い無音)で generateResponse を投機実行し、発話再開で静かにキャンセル＋連結。
  //   第一声(コミット点)で committed=true、生成完了で commitTurn(副作用)＋確定応答を renderer へ。
  const coalesceOn = process.env[COALESCE_ENABLED_ENV] === '1';
  let lastAudioStreamed = false;
  // 適応(段階②)の窓更新を VadRuntime へ橋渡し。vad は後で生成するので前方参照ホルダ経由。
  let applySilenceWindow: (ms: number) => void = () => {};
  const coordinator = coalesceOn
    ? new VoiceTurnCoordinator({
        generate: async (text, signal, onFirstAudio) => {
          const gen = await generateResponse(text, runtime, mainWindow, signal, onFirstAudio, {
            playFiller: false, // 投機中は出さない(コミット前のちらつき回避)
          });
          if (!gen) throw new Error('not ready');
          lastAudioStreamed = gen.audioStreamed;
          return gen.response;
        },
        commit: async (text, response) => {
          await commitTurn(text, response, lastAudioStreamed, runtime, mainWindow);
        },
        emitResponse: (response) => {
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send('ene:voice-response', response);
        },
        setSilenceWindow: (ms) => applySilenceWindow(ms),
      })
    : null;
  const coalesce: CoalesceHooks | undefined = coordinator
    ? {
        onSpeechStart: () => coordinator.onSpeechStart(),
        onSpeechEnd: () => coordinator.onSpeechEnd(),
        onProvisionalEnd: (text) => coordinator.onProvisionalEnd(text),
        reset: () => coordinator.reset(),
        minSilenceMs: VAD_PROVISIONAL_SILENCE_MS,
      }
    : undefined;
  if (coalesceOn) log.info('coalescing ON (speculative generation; provisional turn-end)');

  const vad = new VadRuntime(mainWindow, backchannel, listenOnly, correctTranscript, coalesce);
  // 適応(段階②): coordinator が算出した無音窓を segmenter へ反映(§6.2: ms のみ・本文なし)。
  if (coalesceOn) {
    applySilenceWindow = (ms: number): void => {
      vad.setSilenceWindow(ms);
      log.info(`coalesce window → ${ms}ms (adaptive)`);
    };
  }
  ipcMain.handle('ene:vad-start', async (): Promise<boolean> => vad.start());
  ipcMain.on('ene:vad-frame', (_event, frame: Float32Array) => {
    void vad.pushFrame(frame instanceof Float32Array ? frame : new Float32Array(frame));
  });
  ipcMain.on('ene:vad-stop', () => vad.stop());
  ipcMain.on('ene:vad-speaking', (_event, speaking: boolean) => vad.setSpeaking(speaking));

  // マイク入力方式の取得(設定・task_17 Phase C)。変更は右クリックメニューから(main が保存＋通知)。
  ipcMain.handle('ene:get-voice-input-mode', async (): Promise<VoiceInputMode> => runtime.voiceInputMode);

  ipcMain.handle('ene:send-message', async (_event, text: string): Promise<ConversationResponse> => {
    try {
      return await handleSendMessage(text, runtime, mainWindow);
    } catch (err) {
      // IPC ハンドラから例外を漏らさない(Renderer をクラッシュさせない)。
      log.error('send-message handler failed', { name: (err as Error).name });
      return ERROR_RESPONSE;
    }
  });

  ipcMain.handle('ene:get-character-info', async (): Promise<CharacterInfo> => {
    if (runtime.charContext) {
      // アニメ定義(任意)。無ければ単一 portrait 表示にフォールバック(F-ANIM-11)。
      const animation =
        (await loadAnimationData(runtime.charContext.identity.characterId)) ?? undefined;
      return {
        name: runtime.charContext.identity.name,
        portraitUrl: await readPortraitDataUrl(runtime.charContext.portraitPath),
        animation,
      };
    }
    return { name: 'ENE', portraitUrl: '' };
  });

  // 起動挨拶を1回だけ返す(pull 方式。取得後はクリアして再表示しない)。
  ipcMain.handle('ene:get-initial-greeting', async (): Promise<string | null> => {
    const greeting = runtime.initialGreeting;
    runtime.initialGreeting = null;
    return greeting;
  });

  // 起動準備の完了状態(renderer の初期表示用・pull)。完了通知は ene:app-ready(push)で送る。
  ipcMain.handle('ene:is-ready', async (): Promise<boolean> => runtime.ready);

  ipcMain.handle('ene:has-api-key', async (): Promise<boolean> => isApiKeyAvailable());

  ipcMain.handle('ene:save-api-key', async (_event, key: string): Promise<void> => {
    // 形式検証・疎通テストはダイアログ側(task_09)で行う。ここは保存のみ。
    await encryptAndSaveApiKey(key);
    runtime.apiKey = key;
  });

  ipcMain.handle('ene:move-window', async (_event, x: number, y: number): Promise<void> => {
    mainWindow.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    // ドラッグ中の連続呼び出しに備え、保存はデバウンスする。
    debouncedSavePosition(x, y);
  });

  ipcMain.handle('ene:reset-window-position', async (): Promise<void> => {
    resetToDefaultPosition(mainWindow);
  });

  ipcMain.handle('ene:set-ignore-mouse-events', async (_event, ignore: boolean): Promise<void> => {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.handle('ene:show-character-context-menu', async (): Promise<void> => {
    showCharacterContextMenu(mainWindow, runtime);
  });

  // マイク音声の文字起こし(task_17 Phase B)。renderer の push-to-talk から呼ばれる。
  // §6.2 厳守: 認識テキスト本文はログに出さない(文字数のみ)。
  ipcMain.handle(
    'ene:transcribe-audio',
    async (_event, samples: Float32Array): Promise<TranscribeResult> => {
      try {
        if (!(await isSttModelAvailable())) {
          return { ok: false, message: '…ごめん、耳がまだ準備できてないみたい。' };
        }
        // IPC 越しに渡るのは Float32Array(構造化複製)。念のため型を正規化する。
        const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples);
        const text = await transcribe(pcm);
        if (!text) {
          return { ok: false, message: '…ん? うまく聞き取れなかった。もう一回言ってみて?' };
        }
        log.info(`stt transcribed (${text.length} chars)`);
        return { ok: true, text };
      } catch (err) {
        log.warn('transcribe failed', { name: (err as Error).name });
        return { ok: false, message: '…耳の調子が悪いみたい。ごめんね、もう一回試して?' };
      }
    },
  );

  // 入力欄オープン時のキャッシュウォーム(task_14 Phase 3・レイテンシ施策)。fire-and-forget。
  ipcMain.handle('ene:warm-cache', async (): Promise<void> => {
    const { charContext, apiKey } = runtime;
    if (charContext && apiKey) {
      const semantic = await getSemantic();
      void warmPromptCache(charContext, semantic, apiKey);
    }
  });
}

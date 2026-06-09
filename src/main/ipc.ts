import { ipcMain, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { nowLocalIso, todayLocalYmd } from '../shared/datetime';
import { log } from '../shared/logger';
import { WINDOW_WIDTH, WINDOW_HEIGHT, VOICE_STREAMING_ENABLED_ENV } from '../shared/constants';
import { appendShortTerm } from '../memory/short-term';
import { buildConversationMemory } from '../memory/context-builder';
import { requestExtraction, enforceShortTermCap } from '../memory/extraction-scheduler';
import { classifyTopic } from '../router/router';
import { chat, makeLlmComplete, warmPromptCache } from '../conversation/client';
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
import { VadRuntime } from './vad-runtime';
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

// send-message の統合フロー(設計書 §4.2 / task_07 §7)。
async function handleSendMessage(
  text: string,
  runtime: AppRuntime,
  mainWindow: BrowserWindow,
): Promise<ConversationResponse> {
  const { charContext, apiKey } = runtime;
  if (!charContext || !apiKey) {
    return NOT_READY;
  }

  // 確定テキストを喋らせる(音声有効時のみ・best-effort・非ストリーミング合成)。
  // 非ストリーミング経路の最終発話、および OS コマンド失敗時のエラー発話に使う。
  const speakOut = (spokenText: string, emo: EmotionLabel): void => {
    const { tts, voiceConfig } = runtime;
    if (tts && voiceConfig) void speakResponse(spokenText, emo, tts, voiceConfig, mainWindow);
  };

  // 認証失効(401/402/429)を検知したら APIキーダイアログを再表示し、保存後は runtime を更新。
  const onAuthError = (error: unknown): void => {
    void handleApiAuthError(error, mainWindow, (key) => {
      runtime.apiKey = key;
    });
  };

  // 計測(レイテンシ・§6.2 厳守=会話内容は載せず ms のみ)。応答確定までの体感経路を測る。
  const t0 = performance.now();

  // 1. user を短期記憶へ ＋ 関係の事実を記録(開示ゲーティングの素・task_16)
  //    recordConversationTurn は active-character.json を書くため、それを読む記憶構築より先に確定する。
  await appendShortTerm({ role: 'user', text, timestamp: nowLocalIso(), extracted: false });
  await recordConversationTurn();
  const tMem0 = performance.now();

  // 2+3. Router と記憶コンテキスト構築は互いに独立 → 並列実行(B-03b)。
  //   - Router: トピック判定(失敗しても fallback で続行)。
  //   - 記憶: 全件横断想起・Router 非依存・心/開示バイアス注入(task_15/16)。
  //           episodic を1回だけロードして心の導出と想起で使い回す(B-14a: 二重ロード解消)。
  const [routerResult, memoryContext] = await Promise.all([
    classifyTopic(text, charContext.knowledgeDomains, apiKey),
    buildConversationMemory({ text, limit: 5 }),
  ]);
  const tMem1 = performance.now();

  // 4. 本会話。音声有効＋ストリーミング ON(ENE_VOICE_STREAMING=1)なら、文ができた端から合成して
    //    **第一声を早める**(B-06)。それ以外は従来の非ストリーミング(4層防御込み)。
    //    ストリーミングは破壊的でないが未実機検証のため、失敗時は非ストリーミングへ確実にフォールバックする。
  const { tts, voiceConfig } = runtime;
  const streamingOn =
    Boolean(tts && voiceConfig) && process.env[VOICE_STREAMING_ENABLED_ENV] === '1';
  let response: ConversationResponse;
  let audioStreamed = false;
  if (streamingOn && tts && voiceConfig) {
    try {
      response = await streamVoiceChat(
        text, charContext, memoryContext, routerResult, apiKey, tts, voiceConfig, mainWindow,
      );
      audioStreamed = true; // ストリーミング中に音声は送出済み
    } catch (e) {
      log.warn('voice streaming failed; falling back to non-streaming', { name: (e as Error).name });
      response = await chat(text, charContext, memoryContext, routerResult, apiKey, { onAuthError });
    }
  } else {
    response = await chat(text, charContext, memoryContext, routerResult, apiKey, { onAuthError });
  }

  // 計測ログ:応答確定までの内訳(ms のみ)。記憶抽出は背景化済みなので total に乗らない(B-01)。
  //   total      = STT後〜応答確定(体感の本体)
  //   mem+router = 記憶構築＋Router(並列・B-03b/B-14a の効果が出る所)
  //   response   = Claude 往復(固定費。ストリーミング時は第一声が早い)
  log.info(
    `turn latency: total=${Math.round(performance.now() - t0)}ms ` +
      `mem+router=${Math.round(tMem1 - tMem0)}ms response=${Math.round(performance.now() - tMem1)}ms` +
      (streamingOn ? ' (streaming)' : ''),
  );

  // 5. assistant を短期記憶へ
  await appendShortTerm({
    role: 'assistant',
    text: response.message,
    timestamp: nowLocalIso(),
    extracted: false,
  });

  // 5b. 短期記憶のハード上限を死守(採用(a))。通常は未到達(早期 return)。
  //     超過時=抽出が大幅遅延/失敗している異常時のみ、ここで同期抽出を1回払って上限を守る。
  await enforceShortTermCap(makeLlmComplete(apiKey));

  // 5c. 通常の記憶抽出は**バックグラウンド**へ(応答クリティカルパスから外す・B-01/B-02)。
  //     未抽出が閾値以上たまった時だけ発火し、直列化ロックで多重実行を防ぐ。await しない。
  requestExtraction(makeLlmComplete(apiKey));

  // 6. OS コマンドなら実行(失敗時はキャラ口調フォールバックに差し替え)。
  //    エラー文は短いので非ストリーミングで喋る(本文ストリーミングの有無に関わらず)。
  if (response.type === 'os_command') {
    const osResult = await executeOsCommand(response.command);
    if (!osResult.ok && osResult.message) {
      speakOut(osResult.message, 'neutral');
      return { type: 'chat', message: osResult.message };
    }
  }

  // 7. 誕生日当日に「おめでとう」等で触れられたら、祝われた事実を記録(設計書 §3.1 / §5.4)
  if (charContext.birthdayHint === 'today') {
    const congrats = ['誕生日', 'おめでとう', 'ハッピーバースデー', 'Happy Birthday', 'バースデー'];
    if (congrats.some((w) => text.includes(w))) {
      await recordBirthdayCelebrated(todayLocalYmd().year);
    }
  }

  // 8. 音声:ストリーミングで既に送出済みなら何もしない。非ストリーミング経路のみ、ここで確定応答を喋る。
  //    読み(reading)はルビ解決済の音声用テキスト(無ければ表示文)。
  if (!audioStreamed) {
    const emo: EmotionLabel = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
    speakOut(response.reading ?? response.message, emo);
  }
  return response;
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
    rng: Math.random,
  });

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
  const vad = new VadRuntime(mainWindow, backchannel, listenOnly, correctTranscript);
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

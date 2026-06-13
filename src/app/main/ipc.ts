import { ipcMain, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { log } from '../../shared/logger';
import {
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  COALESCE_ENABLED_ENV,
  LISTENING_ENABLED_ENV,
  VAD_PROVISIONAL_SILENCE_MS,
  GREETING_GENERATION_TIMEOUT_MS,
} from '../../shared/constants';
import { replaceLastAssistantText, appendShortTerm } from '../../memory/short-term';
import { nowLocalIso } from '../../shared/datetime';
import { correctNameMishear } from '../../voice/name-correction';
import { getSemantic } from '../../memory/semantic';
import { warmPromptCache } from '../../conversation/client';
import { loadAnimationData } from '../../character/animation-loader';
import { loadVrmConfig, loadVrmModelBytes, buildVrmRenderConfig } from '../../character/vrm-loader';
import { loadAppSettings, saveVrmDisplay, saveAudioPrefs } from '../../shared/node/app-settings';
import { saveWindowPosition } from './window-position';
import { showCharacterContextMenu } from './character-context-menu';
import { VadRuntime, type CoalesceHooks } from './vad-runtime';
import { VoiceTurnCoordinator } from './voice-turn-coordinator';
import { BackchannelController } from './backchannel-controller';
import { transcribe, isSttModelAvailable } from '../../voice/stt-transcriber';
import { generateResponse, commitTurn, handleSendMessage } from './turn-engine';
import { speakResponse } from './voice-runtime';
import type { ConversationResponse } from '../../shared/types/conversation';
import type { CharacterInfo } from '../../shared/types/ipc';
import type { TranscribeResult } from '../../shared/types/stt';
import type { VrmRenderConfig, VrmDisplayParams } from '../../shared/types/vrm';
import type { VoiceInputMode } from '../../shared/types/settings';
import type { AppRuntime } from './app-runtime';

// IPC ハンドラ集約(設計書 §4)。ターンの司令塔(generateResponse/commitTurn/handleSendMessage)は
// turn-engine.ts に分離し、本ファイルは IPC 登録と各種ハンドラの配線に専念する。
// すべての業務ロジックは main 側。Renderer は IPC 経由でのみ呼ぶ(API キーも漏らさない)。

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

  // コアレッシング(段階①): 投機生成＋連結。**既定ON**(ENE_COALESCE=0 で無効化=従来の renderer 駆動経路)。
  //   暫定ターン終了(短い無音)で generateResponse を投機実行し、発話再開で静かにキャンセル＋連結。
  //   第一声(コミット点)で committed=true、生成完了で commitTurn(副作用)＋確定応答を renderer へ。
  const coalesceOn = process.env[COALESCE_ENABLED_ENV] !== '0';
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
        // barge-in(生成完了後)時に、最新 assistant 記憶を「聞かせた分」へ切り詰める(Phase B)。
        updateLastAssistant: (heardText) => void replaceLastAssistantText(heardText),
        // 傾聴モード(docs/listening-mode-design.md)。既定 ON(ENE_LISTENING=0 で無効化)。
        listeningEnabled: process.env[LISTENING_ENABLED_ENV] !== '0',
        // 頬杖姿勢の出し入れ/あくびを renderer へ(VRM 視覚は Phase 4 で受信側を配線)。
        onListeningChange: (on) => {
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send('ene:listening', on);
        },
        onYawn: () => {
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send('ene:yawn');
        },
      })
    : null;
  const coalesce: CoalesceHooks | undefined = coordinator
    ? {
        onSpeechStart: () => coordinator.onSpeechStart(),
        onSpeechEnd: () => coordinator.onSpeechEnd(),
        onProvisionalEnd: (text) => coordinator.onProvisionalEnd(text),
        onBargeInTiming: (isEarly) => coordinator.onBargeInTiming(isEarly),
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
  // barge-in 時に renderer が「実際に聞かせた発言(再生済みの文を連結)」を報告する(Phase B)。
  // coordinator が生成中なら中断＋切り詰めコミット、生成完了済みなら最新 assistant を上書きする。
  ipcMain.on('ene:voice-heard', (_event, heardText: string) => coordinator?.onBargeIn(heardText));

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

  // --- VRM 表示(F・3D化)。vrm.json が無ければ null=renderer は PNG 立ち絵へフォールバック ---
  // 表情マップ＋初期パラメータ(ユーザー上書きをマージ済み)。モデル本体は別 IPC で取得する。
  ipcMain.handle('ene:get-vrm-config', async (): Promise<VrmRenderConfig | null> => {
    const characterId = runtime.charContext?.identity.characterId;
    if (!characterId) return null;
    const config = await loadVrmConfig(characterId);
    if (!config) return null;
    const settings = await loadAppSettings();
    return buildVrmRenderConfig(config, settings.vrmDisplay);
  });

  // VRM モデル本体(ArrayBuffer)。10MB を base64 化せず生バイトで渡す(§3.8)。読めなければ null。
  ipcMain.handle('ene:get-character-model', async (): Promise<ArrayBuffer | null> => {
    const characterId = runtime.charContext?.identity.characterId;
    if (!characterId) return null;
    const config = await loadVrmConfig(characterId);
    if (!config) return null;
    return loadVrmModelBytes(characterId, config.model);
  });

  // GUI スライダーの調整結果を保存(renderer は即時ローカル反映済み・ここは永続化のみ)。
  ipcMain.handle('ene:set-vrm-display', async (_event, display: Partial<VrmDisplayParams>): Promise<void> => {
    await saveVrmDisplay(display);
  });

  // 音量・ミュート(トリミの声=出力・UI改修 段階3)。renderer は即時ローカル反映済み・ここは永続化のみ。
  ipcMain.handle('ene:get-audio-prefs', async (): Promise<{ volume: number; muted: boolean }> => {
    const s = await loadAppSettings();
    return { volume: s.outputVolume ?? 1, muted: s.muted ?? false };
  });
  ipcMain.handle(
    'ene:save-audio-prefs',
    async (_event, volume: number, muted: boolean): Promise<void> => {
      await saveAudioPrefs(volume, muted);
    },
  );

  // じゃあね(UI改修 段階4): タスクバーへ最小化する(クリックで戻る)。常時タスクバー表示なのでボタンは常にある。
  // 完全終了はキャラ右クリック「アプリを終了」or タスクバー右クリック「閉じる」(window-all-closed→quit)。
  ipcMain.handle('ene:goodbye', (): void => {
    if (!mainWindow.isDestroyed()) mainWindow.minimize();
  });

  // 離席(UI改修 段階5): 離席中フラグを保持(自発発話の停止に使う・idle-talk-manager が参照)。
  ipcMain.on('ene:set-away', (_event, away: boolean) => {
    runtime.away = away;
  });

  // ウィンドウの可視性を renderer へ通知(非表示中は VRM 描画を止める=軽量原則 柱4・§3.6)。
  const notifyVisibility = (visible: boolean): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('ene:window-visibility', visible);
  };
  mainWindow.on('hide', () => notifyVisibility(false));
  mainWindow.on('minimize', () => notifyVisibility(false));
  mainWindow.on('show', () => notifyVisibility(true));
  mainWindow.on('restore', () => notifyVisibility(true));

  // 起動挨拶を1回だけ返す(pull 方式。取得後はクリアして再表示しない)。
  // P3: オフスクリーンライフ(LLM)生成を最大 GREETING_GENERATION_TIMEOUT_MS 待ち、間に合えば差し替える。
  // 超過/失敗/初回は定型文フォールバック(initialGreeting)。オフラインでも壊れない。
  ipcMain.handle('ene:get-initial-greeting', async (): Promise<string | null> => {
    const promise = runtime.greetingPromise;
    if (promise) {
      runtime.greetingPromise = null;
      const generated = await Promise.race([
        promise.catch(() => null),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), GREETING_GENERATION_TIMEOUT_MS),
        ),
      ]);
      if (generated) runtime.initialGreeting = generated;
    }
    const greeting = runtime.initialGreeting;
    runtime.initialGreeting = null;
    // 起動挨拶も assistant 発話として短期記憶へ残す(自発発話 idle-talk と同じ extracted:false の assistant)。
    //  狙い: ①ユーザーが挨拶へ返したとき、Claude が自分の第一声を文脈で見られる(返事が宙に浮かない)
    //        ②記憶抽出の対象になり、その日の会話の一部として中期記憶へ繋がる。
    //  best-effort=書き込み失敗しても挨拶表示は続行(会話・起動に影響させない)。
    if (greeting) {
      try {
        await appendShortTerm({ role: 'assistant', text: greeting, timestamp: nowLocalIso(), extracted: false });
      } catch (e) {
        log.warn('greeting short-term append failed', { name: (e as Error).name });
      }
      // 起動挨拶も声に出す(通常応答・自発発話と同じ speakResponse 経路)。これまで挨拶だけ
      // 吹き出し表示のみで無音だったため配線する。fire-and-forget=テキスト返却(吹き出し)を待たせない。
      // tts/voiceConfig が揃っている時だけ(オフライン/エンジン未配置なら従来どおり無音テキスト)。emotion は neutral。
      if (runtime.tts && runtime.voiceConfig) {
        void speakResponse(greeting, 'neutral', runtime.tts, runtime.voiceConfig, mainWindow);
      }
    }
    return greeting;
  });

  // 起動準備の完了状態(renderer の初期表示用・pull)。完了通知は ene:app-ready(push)で送る。
  ipcMain.handle('ene:is-ready', async (): Promise<boolean> => runtime.ready);

  ipcMain.handle('ene:move-window', async (_event, x: number, y: number): Promise<void> => {
    mainWindow.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    // ドラッグ中の連続呼び出しに備え、保存はデバウンスする。
    debouncedSavePosition(x, y);
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

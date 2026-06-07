import { ipcMain, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { nowLocalIso, todayLocalYmd } from '../shared/datetime';
import { log } from '../shared/logger';
import { WINDOW_WIDTH, WINDOW_HEIGHT } from '../shared/constants';
import { appendShortTerm } from '../memory/short-term';
import { buildMemoryContext, buildHeartDeps } from '../memory/context-builder';
import { extractFromShortTerm } from '../memory/extraction-trigger';
import { classifyTopic } from '../router/router';
import { chat, makeLlmComplete, warmPromptCache } from '../conversation/client';
import { getSemantic } from '../memory/semantic';
import { executeOsCommand } from '../os/executor';
import { recordBirthdayCelebrated, recordConversationTurn } from '../character/active-character';
import { loadAnimationData } from '../character/animation-loader';
import { isApiKeyAvailable, encryptAndSaveApiKey } from '../storage/encryption';
import { saveWindowPosition, resetToDefaultPosition } from './window-position';
import { showCharacterContextMenu } from './character-context-menu';
import { handleApiAuthError } from './api-key-auto-recovery';
import { speakResponse } from './voice-runtime';
import { VadRuntime } from './vad-runtime';
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

  // 確定応答を喋らせる(音声有効時のみ・best-effort)。吹き出しは即返し、音声は文ごとに後追いで届く。
  const speak = (r: ConversationResponse): ConversationResponse => {
    const { tts, voiceConfig } = runtime;
    if (tts && voiceConfig) {
      const emo: EmotionLabel = r.type === 'chat' ? (r.emotion ?? 'neutral') : 'neutral';
      // 読み(ひらがな)があれば TTS はそれを喋る(誤読対策・task_17)。無ければ表示文を読む。
      void speakResponse(r.reading ?? r.message, emo, tts, voiceConfig, mainWindow);
    }
    return r;
  };

  // 認証失効(401/402/429)を検知したら APIキーダイアログを再表示し、保存後は runtime を更新。
  const onAuthError = (error: unknown): void => {
    void handleApiAuthError(error, mainWindow, (key) => {
      runtime.apiKey = key;
    });
  };

  // 短期記憶 overflow 時の抽出(Claude 呼び出しを注入)。Memory 層は Claude を直接知らない。
  const onOverflow = (): Promise<void> => extractFromShortTerm('overflow', makeLlmComplete(apiKey));

  // 1. user を短期記憶へ ＋ 関係の事実を記録(開示ゲーティングの素・task_16)
  await appendShortTerm({ role: 'user', text, timestamp: nowLocalIso(), extracted: false }, onOverflow);
  await recordConversationTurn();

  // 2. トピック判定(失敗しても fallback で続行)
  const routerResult = await classifyTopic(text, charContext.knowledgeDomains, apiKey);

  // 3. 記憶コンテキスト(全件横断想起・Router 非依存・心/開示バイアスを注入・task_15/16)
  const heartDeps = await buildHeartDeps();
  const memoryContext = await buildMemoryContext({ text, limit: 5 }, heartDeps);

  // 4. 本会話(4層防御込み)。認証失効時はダイアログ再表示。
  const response = await chat(text, charContext, memoryContext, routerResult, apiKey, { onAuthError });

  // 5. assistant を短期記憶へ
  await appendShortTerm(
    { role: 'assistant', text: response.message, timestamp: nowLocalIso(), extracted: false },
    onOverflow,
  );

  // 6. OS コマンドなら実行(失敗時はキャラ口調フォールバックに差し替え)
  if (response.type === 'os_command') {
    const osResult = await executeOsCommand(response.command);
    if (!osResult.ok && osResult.message) {
      return speak({ type: 'chat', message: osResult.message });
    }
  }

  // 7. 誕生日当日に「おめでとう」等で触れられたら、祝われた事実を記録(設計書 §3.1 / §5.4)
  if (charContext.birthdayHint === 'today') {
    const congrats = ['誕生日', 'おめでとう', 'ハッピーバースデー', 'Happy Birthday', 'バースデー'];
    if (congrats.some((w) => text.includes(w))) {
      await recordBirthdayCelebrated(todayLocalYmd().year);
    }
  }

  return speak(response);
}

export function registerIpcHandlers(mainWindow: BrowserWindow, runtime: AppRuntime): void {
  // ハンズフリー VAD(task_17 Phase C)。renderer から連続フレームを受け、発話区間を
  // 文字起こしして確定テキストを renderer へ返す(renderer はそれを send-message に流す)。
  const vad = new VadRuntime(mainWindow);
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

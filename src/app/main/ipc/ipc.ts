/* eslint-disable max-lines -- IPC ハンドラ登録・配線の集約点(ターン司令塔は turn-engine、設定系は
   settings-ipc へ分離済)。残りは宣言的な配線の列挙でまとまりを保つ例外(§8.5)。 */
import { ipcMain, type BrowserWindow } from 'electron';
import { log } from '../../../shared/logger';
import {
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  COALESCE_ENABLED_ENV,
  LISTENING_ENABLED_ENV,
  VAD_PROVISIONAL_SILENCE_MS,
  GREETING_GENERATION_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
} from '../../../shared/constants';
import { replaceLastAssistantText, appendShortTerm } from '../../../memory/core/short-term';
import { nowLocalIso } from '../../../shared/datetime';
import { getSemantic } from '../../../memory/core/semantic';
import { warmPromptCache } from '../../../conversation/client';
import { loadVrmConfig, loadVrmModelBytes, buildVrmRenderConfig } from '../../../character/vrm-loader';
import { loadAppSettings, saveVrmDisplay, saveAudioPrefs } from '../../../shared/node/app-settings';
import { saveWindowPosition } from '../window/window-position';
import { VadRuntime, type CoalesceHooks } from '../voice/vad-runtime';
import { VoiceTurnCoordinator } from '../../../conversation/voice-turn-coordinator';
import { BackchannelController } from '../voice/backchannel-controller';
import { isSttModelAvailable } from '../../../voice/stt/stt-transcriber';
import { transcribeViaWorker } from '../voice/stt-worker-client';
import { generateResponse, commitTurn, handleSendMessage } from '../orchestration/turn-engine';
import { speakResponse } from '../voice/voice-runtime';
import type { ConversationResponse } from '../../../shared/types/conversation';
import type { CharacterInfo } from '../../../shared/types/ipc';
import type { TranscribeResult } from '../../../shared/types/stt';
import type { VrmRenderConfig, VrmDisplayParams } from '../../../shared/types/vrm';
import type { EqBand } from '../../../shared/types/voice';
import { resolveVoice, type AppRuntime } from '../bootstrap/app-runtime';
import { IPC } from '../../../shared/ipc-channels';

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
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.BACKCHANNEL, wav);
    },
    sendFillerText: (text) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.THINKING_FILLER, text);
    },
    rng: Math.random,
  });
  // 思考フィラーを runtime 経由で handleSendMessage から呼べるよう配線(B-15連動)。
  // テキスト入力でも鳴らせるよう事前合成を先に試みる(best-effort・TTS 起動後に整う)。
  runtime.playThinkingFiller = () => backchannel.playThinkingFiller();
  void backchannel.prepare();

  // ハンズフリー VAD(task_17 Phase C)。renderer から連続フレームを受け、発話区間を
  // 文字起こしして確定テキストを renderer へ返す(renderer はそれを send-message に流す)。

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
          // 音声が「第一声=コミット」した時だけテキストターンを畳む(相互排他)。投機段階では畳まない=
          // タイピング中のマイク雑音由来の投機gen で誤ってテキストターンを中断しない(穴G)。
          const onCommitted = (): void => {
            runtime.textTurn?.ctrl.abort();
            runtime.textTurn = null;
            runtime.setResponseActive?.(true); // 音声応答の第一声=barge-in 窓を開く
            onFirstAudio();
          };
          runtime.generating = true; // 抽出をこの生成中は見送らせる(穴D)
          const gen = await generateResponse(text, runtime, mainWindow, signal, onCommitted, {
            playFiller: false, // 投機中は出さない(コミット前のちらつき回避)
          }).finally(() => {
            runtime.generating = false;
          });
          if (!gen) throw new Error('not ready');
          lastAudioStreamed = gen.audioStreamed;
          return gen.response;
        },
        commit: async (text, response) => {
          await commitTurn(text, response, lastAudioStreamed, runtime, mainWindow);
        },
        emitResponse: (response) => {
          if (!mainWindow.isDestroyed())
            mainWindow.webContents.send(IPC.VOICE_RESPONSE, response);
        },
        setSilenceWindow: (ms) => applySilenceWindow(ms),
        // barge-in(生成完了後)時に、最新 assistant 記憶を「聞かせた分」へ切り詰める(Phase B)。
        updateLastAssistant: (heardText) => void replaceLastAssistantText(heardText),
        // 傾聴モード(docs/listening-mode-design.md)。既定 ON(ENE_LISTENING=0 で無効化)。
        listeningEnabled: process.env[LISTENING_ENABLED_ENV] !== '0',
        // 頬杖姿勢の出し入れ/あくびを renderer へ(VRM 視覚は Phase 4 で受信側を配線)。
        onListeningChange: (on) => {
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.LISTENING, on);
        },
        onYawn: () => {
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.YAWN);
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

  const vad = new VadRuntime(mainWindow, backchannel, coalesce);
  // barge-in 判定窓を main の応答ターンで駆動する(構造的修正)。第一声(コミット)で true、barge-in/次ターンで false。
  runtime.setResponseActive = (active: boolean): void => vad.setResponseActive(active);
  // 実発話があったのに STT が空(取りこぼし)=ユーザを無音で放置しない。キャラ口調で聞き返す(信頼性保証)。
  // 自発発話/挨拶と同じ経路(吹き出し PROACTIVE_MESSAGE ＋ speakResponse)。文言は identity.json から(§5.1)。
  // 短期記憶には残さない(会話内容ではなく「聞き返し」の合図)。
  vad.onUnintelligible = (): void => {
    const prompts = runtime.charContext?.identity.unintelligiblePrompts;
    if (!prompts || prompts.length === 0) return; // 文が無ければ何もしない(後方互換)
    const message = prompts[Math.floor(Math.random() * prompts.length)];
    if (!message) return;
    const response: ConversationResponse = { type: 'chat', message };
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.PROACTIVE_MESSAGE, response);
    const voice = resolveVoice(runtime.tts, runtime.voiceConfig);
    if (!voice) return; // 音声無効=吹き出しのみ(従来挙動)
    runtime.selfSpeech?.abort();
    const ctrl = new AbortController();
    runtime.selfSpeech = ctrl;
    runtime.setResponseActive?.(true); // 聞き返しも barge-in で止められる(自発発話と同じ)
    void speakResponse(message, 'neutral', voice.tts, voice.voiceConfig, mainWindow, ctrl.signal);
  };
  // 起動ゲートで耳(VAD)も事前ロードさせる=「ちょっと待って」完了時点で耳まで ready(初回マイクに遅延を出さない)。
  runtime.warmVad = (): Promise<void> => vad.warm();
  // 適応(段階②): coordinator が算出した無音窓を segmenter へ反映(§6.2: ms のみ・本文なし)。
  if (coalesceOn) {
    applySilenceWindow = (ms: number): void => {
      vad.setSilenceWindow(ms);
      log.info(`coalesce window → ${ms}ms (adaptive)`);
    };
  }
  ipcMain.handle(IPC.VAD_START, async (): Promise<boolean> => vad.start());
  ipcMain.on(IPC.VAD_FRAME, (_event, frame: Float32Array) => {
    void vad.pushFrame(frame instanceof Float32Array ? frame : new Float32Array(frame));
  });
  ipcMain.on(IPC.VAD_STOP, () => vad.stop());
  ipcMain.on(IPC.VAD_SPEAKING, (_event, speaking: boolean) => vad.setSpeaking(speaking));
  // 現在ターンの単一管理(#8/#9): テキスト/音声の発話を1つの「現在ターン」に保つ。新ターンは前ターンを
  // supersede(中断)し、barge-in も同じ機構で止める。中断は Claude ストリーム＋TTS合成を signal で打ち切る
  // ので、捨てた生成が API/エンジンに残って次を詰まらせない(遅延して返った応答は無視する)。
  const beginTextTurn = (text: string): AbortController => {
    runtime.textTurn?.ctrl.abort(); // 前のテキストターンを破棄(supersede)
    coordinator?.reset(); // 音声(投機)ターンも畳む(相互排他)
    runtime.setResponseActive?.(false); // 新ターン開始=前の応答の barge-in 窓を閉じる(第一声で開き直す)
    const ctrl = new AbortController();
    runtime.textTurn = { ctrl, userText: text };
    return ctrl;
  };

  // barge-in: renderer が「実際に聞かせた発言(再生済みの文を連結)」を報告する(Phase B)。テキスト発話中なら
  // 中断＋「ユーザ＋聞かせた分」をコミット(全文は記憶しない)、音声/生成完了後は coordinator に委ねる(切り詰め)。
  ipcMain.on(IPC.VOICE_HEARD, (_event, heardText: string) => {
    runtime.setResponseActive?.(false); // barge-in=この応答の窓を閉じる
    // 自発発話/挨拶(ターン機構の外)も止める(穴A)。
    runtime.selfSpeech?.abort();
    runtime.selfSpeech = null;
    const tt = runtime.textTurn;
    if (tt) {
      tt.ctrl.abort();
      runtime.textTurn = null;
      // audioStreamed=true で commit 内の再発話を抑止(停止は renderer の stopPlayback 済み)。空なら記憶を壊さない。
      if (heardText)
        void commitTurn(tt.userText, { type: 'chat', message: heardText }, true, runtime, mainWindow);
    } else {
      coordinator?.onBargeIn(heardText);
    }
  });

  ipcMain.handle(
    IPC.SEND_MESSAGE,
    async (_event, text: string): Promise<ConversationResponse | null> => {
      const ctrl = beginTextTurn(text);
      const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS); // ハング自動復帰(穴C)
      try {
        return await handleSendMessage(text, runtime, mainWindow, ctrl.signal);
      } catch (err) {
        if (ctrl.signal.aborted) return null; // 中断(barge-in / supersede / タイムアウト)=破棄
        // IPC ハンドラから例外を漏らさない(Renderer をクラッシュさせない)。
        log.error('send-message handler failed', { name: (err as Error).name });
        return ERROR_RESPONSE;
      } finally {
        clearTimeout(timer);
        if (runtime.textTurn?.ctrl === ctrl) runtime.textTurn = null;
      }
    },
  );

  ipcMain.handle(IPC.GET_CHARACTER_INFO, async (): Promise<CharacterInfo> => {
    if (runtime.charContext) {
      return { name: runtime.charContext.identity.name };
    }
    return { name: 'ENE' };
  });

  // --- VRM 表示(F・3D化)。vrm.json が無ければ null=renderer は PNG 立ち絵へフォールバック ---
  // 表情マップ＋初期パラメータ(ユーザー上書きをマージ済み)。モデル本体は別 IPC で取得する。
  ipcMain.handle(IPC.GET_VRM_CONFIG, async (): Promise<VrmRenderConfig | null> => {
    const characterId = runtime.charContext?.identity.characterId;
    if (!characterId) return null;
    const config = await loadVrmConfig(characterId);
    if (!config) return null;
    const settings = await loadAppSettings();
    return buildVrmRenderConfig(config, settings.vrmDisplay);
  });

  // VRM モデル本体(ArrayBuffer)。10MB を base64 化せず生バイトで渡す(§3.8)。読めなければ null。
  ipcMain.handle(IPC.GET_CHARACTER_MODEL, async (): Promise<ArrayBuffer | null> => {
    const characterId = runtime.charContext?.identity.characterId;
    if (!characterId) return null;
    const config = await loadVrmConfig(characterId);
    if (!config) return null;
    return loadVrmModelBytes(characterId, config.model);
  });

  // GUI スライダーの調整結果を保存(renderer は即時ローカル反映済み・ここは永続化のみ)。
  ipcMain.handle(
    IPC.SET_VRM_DISPLAY,
    async (_event, display: Partial<VrmDisplayParams>): Promise<void> => {
      await saveVrmDisplay(display);
    },
  );

  // 音量・ミュート(トリミの声=出力・UI改修 段階3)。renderer は即時ローカル反映済み・ここは永続化のみ。
  ipcMain.handle(IPC.GET_AUDIO_PREFS, async (): Promise<{ volume: number; muted: boolean }> => {
    const s = await loadAppSettings();
    return { volume: s.outputVolume ?? 1, muted: s.muted ?? false };
  });
  ipcMain.handle(
    IPC.SAVE_AUDIO_PREFS,
    async (_event, volume: number, muted: boolean): Promise<void> => {
      await saveAudioPrefs(volume, muted);
    },
  );

  // 声色補正 EQ(voice.json 由来・§4.5)。renderer が起動時に取得し再生グラフへ挟む。音声無効なら空配列。
  ipcMain.handle(IPC.GET_VOICE_EQ, async (): Promise<EqBand[]> => runtime.voiceConfig?.eq ?? []);

  // じゃあね(UI改修 段階4): タスクバーへ最小化する(クリックで戻る)。常時タスクバー表示なのでボタンは常にある。
  // 完全終了はキャラ右クリック「アプリを終了」or タスクバー右クリック「閉じる」(window-all-closed→quit)。
  ipcMain.handle(IPC.GOODBYE, (): void => {
    if (!mainWindow.isDestroyed()) mainWindow.minimize();
  });

  // 離席(UI改修 段階5): 離席中フラグを保持(自発発話の停止に使う・idle-talk-manager が参照)。
  ipcMain.on(IPC.SET_AWAY, (_event, away: boolean) => {
    runtime.away = away;
  });

  // ウィンドウの可視性を renderer へ通知(非表示中は VRM 描画を止める=軽量原則 柱4・§3.6)。
  const notifyVisibility = (visible: boolean): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.WINDOW_VISIBILITY, visible);
  };
  mainWindow.on('hide', () => notifyVisibility(false));
  mainWindow.on('minimize', () => notifyVisibility(false));
  mainWindow.on('show', () => notifyVisibility(true));
  mainWindow.on('restore', () => notifyVisibility(true));

  // 起動挨拶を1回だけ返す(pull 方式。取得後はクリアして再表示しない)。
  // P3: オフスクリーンライフ(LLM)生成を最大 GREETING_GENERATION_TIMEOUT_MS 待ち、間に合えば差し替える。
  // 超過/失敗/初回は定型文フォールバック(initialGreeting)。オフラインでも壊れない。
  ipcMain.handle(IPC.GET_INITIAL_GREETING, async (): Promise<string | null> => {
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
        await appendShortTerm({
          role: 'assistant',
          text: greeting,
          timestamp: nowLocalIso(),
          extracted: false,
        });
      } catch (e) {
        log.warn('greeting short-term append failed', { name: (e as Error).name });
      }
      // 起動挨拶も声に出す(通常応答・自発発話と同じ speakResponse 経路)。これまで挨拶だけ
      // 吹き出し表示のみで無音だったため配線する。fire-and-forget=テキスト返却(吹き出し)を待たせない。
      // tts/voiceConfig が揃っている時だけ(オフライン/エンジン未配置なら従来どおり無音テキスト)。emotion は neutral。
      const voice = resolveVoice(runtime.tts, runtime.voiceConfig);
      if (voice) {
        // 起動挨拶も barge-in で止められるよう中断ハンドルを張り替えて signal を渡し、barge-in 窓を開く(穴A)。
        runtime.selfSpeech?.abort();
        const ctrl = new AbortController();
        runtime.selfSpeech = ctrl;
        runtime.setResponseActive?.(true);
        void speakResponse(greeting, 'neutral', voice.tts, voice.voiceConfig, mainWindow, ctrl.signal);
      }
    }
    return greeting;
  });

  // 起動準備の完了状態(renderer の初期表示用・pull)。完了通知は ene:app-ready(push)で送る。
  ipcMain.handle(IPC.IS_READY, async (): Promise<boolean> => runtime.ready);

  ipcMain.handle(IPC.MOVE_WINDOW, async (_event, x: number, y: number): Promise<void> => {
    mainWindow.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    // ドラッグ中の連続呼び出しに備え、保存はデバウンスする。
    debouncedSavePosition(x, y);
  });

  ipcMain.handle(IPC.SET_IGNORE_MOUSE_EVENTS, async (_event, ignore: boolean): Promise<void> => {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });

  // マイク音声の文字起こし(task_17 Phase B)。renderer の push-to-talk から呼ばれる。
  // §6.2 厳守: 認識テキスト本文はログに出さない(文字数のみ)。
  ipcMain.handle(
    IPC.TRANSCRIBE_AUDIO,
    async (_event, samples: Float32Array): Promise<TranscribeResult> => {
      try {
        if (!(await isSttModelAvailable())) {
          return { ok: false, message: '…ごめん、耳がまだ準備できてないみたい。' };
        }
        // IPC 越しに渡るのは Float32Array(構造化複製)。念のため型を正規化する。
        const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples);
        const text = await transcribeViaWorker(pcm);
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
  ipcMain.handle(IPC.WARM_CACHE, async (): Promise<void> => {
    const { charContext, apiKey } = runtime;
    if (charContext && apiKey) {
      const semantic = await getSemantic();
      void warmPromptCache(charContext, semantic, apiKey);
    }
  });
}

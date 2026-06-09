import type { BrowserWindow } from 'electron';
import { performance } from 'node:perf_hooks';
import { log } from '../shared/logger';
import { loadVoiceConfig } from '../character/voice-loader';
import { AivisSpeechTtsEngine } from '../conversation/aivisspeech-tts';
import { reconcileVoiceConfig } from '../conversation/voice-provisioner';
import { speakText, runVoiceChat } from '../conversation/voice-chat';
import { createJsonStreamParser } from '../conversation/json-stream-parser';
import { buildPrompt } from '../conversation/prompt-builder';
import { makeStreamCall } from '../conversation/client';
import { fallbackResponse } from '../conversation/fallback';
import type { EmotionLabel } from '../shared/types/animation';
import type { TtsEngine, VoiceConfig } from '../shared/types/voice';
import type { CharacterContext } from '../shared/types/character';
import type { MemoryContext } from '../shared/types/memory';
import type { RouterResult } from '../shared/types/router';
import type { ConversationResponse } from '../shared/types/conversation';

// 音声ランタイム(main 側・task_17 Phase A / design-revision-voice §4)。
// 起動時に best-effort で TTS を用意し、応答メッセージを文単位で合成 → renderer へ音声チャンクを送る。
// マイクは Phase B。ここは出力(TTS)のみ。

export interface VoiceRuntime {
  tts: TtsEngine;
  voiceConfig: VoiceConfig;
}

/**
 * 音声を best-effort 初期化する。
 * voice.json が無ければ null(=音声無効・テキストのみ)。**起動はブロックしない**。
 * エンジンが起動していれば `/speakers` で実 styleId を解決(reconcile・HANDOFF 注意2)。
 * 未起動でも同梱 styleId のまま有効化し、後で起動すれば喋れるようにしておく。
 */
export async function initVoice(characterId: string): Promise<VoiceRuntime | null> {
  const config = await loadVoiceConfig(characterId);
  if (!config) return null;
  const tts = new AivisSpeechTtsEngine(config.baseUrl);
  try {
    const styles = await tts.listStyles();
    log.info('voice ready (engine reachable)');
    return { tts, voiceConfig: reconcileVoiceConfig(config, styles) };
  } catch {
    log.warn('voice engine not reachable at startup; using bundled styleId');
    return { tts, voiceConfig: config };
  }
}

/**
 * 音声ストリーミング会話(C1・B-06・第一声短縮)。
 * Claude を**ストリーミング**で呼び、文ができた端から「自称検知(C2)→ ルビ解決 → 合成 → renderer へ送出」する。
 * 戻り値は吹き出し/記憶/OSコマンド用の確定 ConversationResponse(message=発話済みテキスト・ルビ除去済)。
 *
 * 4層防御との関係(設計上の割り切り):プロンプト(第1層)＋**文単位の自称検知ゲート(C2=第2層)**で守る。
 * 既に発話した文は取り消せないため、非ストリーミングの「再生成(第3層)」は使えない。自称文は**喋らずに打ち切り**、
 * 吹き出しはフォールバック文へ差し替える。呼び出し側はこのとき追加音声を出さない。
 *
 * **例外を投げうる**(stream/TTS 失敗)。呼び出し側(ipc)が catch して非ストリーミング経路へフォールバックする。
 */
export async function streamVoiceChat(
  userText: string,
  charContext: CharacterContext,
  memoryContext: MemoryContext,
  routerResult: RouterResult,
  apiKey: string,
  tts: TtsEngine,
  voiceConfig: VoiceConfig,
  mainWindow: BrowserWindow,
): Promise<ConversationResponse> {
  const prompt = buildPrompt(charContext, memoryContext, routerResult, userText);
  const streamCall = makeStreamCall(apiKey);
  // 計測:ストリーミングの肝は「第一声までの時間」。最初のチャンク送出を記録する(§6.2: ms のみ)。
  // 内訳(TTFT/合成)の調査は N-LAT-7 で完了(TTFT 律速=クラウドの床)。ここでは第一声の総時間のみ残す。
  const tStart = performance.now();
  let firstChunkLogged = false;
  const result = await runVoiceChat(streamCall(prompt), {
    tts,
    voiceConfig,
    neverCallsSelf: charContext.identity.selfRecognition.neverCallsSelf,
    makeParser: createJsonStreamParser,
    onAudio: (wav) => {
      if (!firstChunkLogged) {
        firstChunkLogged = true;
        log.info(`first voice chunk at ${Math.round(performance.now() - tStart)}ms (streaming)`);
      }
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('ene:voice-chunk', wav);
    },
  });

  // C2 で自称検知し打ち切った場合はフォールバック文を吹き出しに出す(音声は既に途中で止まっている)。
  if (result.blockedBySelfCheck) {
    log.warn('AI self-reference detected mid-stream; truncated (C2)');
    return fallbackResponse();
  }
  if (result.command) {
    return { type: 'os_command', message: result.spokenText, command: result.command };
  }
  return { type: 'chat', message: result.spokenText, emotion: result.emotion };
}

/**
 * 確定応答(読み=ひらがな or 表示文)を合成し、文ごとに renderer へ音声チャンク(WAV)を送る。
 * 失敗しても会話に影響させない(best-effort)。自称検知は本会話の4層防御で済んでいるため空。
 */
export async function speakResponse(
  spokenText: string,
  emotion: EmotionLabel,
  tts: TtsEngine,
  voiceConfig: VoiceConfig,
  mainWindow: BrowserWindow,
): Promise<void> {
  try {
    await speakText(spokenText, emotion, {
      tts,
      voiceConfig,
      neverCallsSelf: [],
      onAudio: (wav) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('ene:voice-chunk', wav);
      },
    });
  } catch (e) {
    log.warn(`voice synthesis failed: ${(e as Error).name}`);
  }
}

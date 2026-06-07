import type { BrowserWindow } from 'electron';
import { log } from '../shared/logger';
import { loadVoiceConfig } from '../character/voice-loader';
import { AivisSpeechTtsEngine } from '../conversation/aivisspeech-tts';
import { reconcileVoiceConfig } from '../conversation/voice-provisioner';
import { speakText } from '../conversation/voice-chat';
import type { EmotionLabel } from '../shared/types/animation';
import type { TtsEngine, VoiceConfig } from '../shared/types/voice';

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

import { createVoiceStreamParser } from './stream-parser';
import { detectAiSelfReference } from './ai-self-check';
import { resolveStyle } from '../character/voice-loader';
import type { EmotionLabel } from '../shared/types/animation';
import type { OsCommand } from '../shared/types/os';
import type { TtsEngine, VoiceConfig } from '../shared/types/voice';

// 音声会話のストリーミング統合(task_17 C1/C2 / design-revision-voice §2,§3)。
//
// Claude のストリーム → stream-parser → C2 文単位ゲート → TtsEngine.speak → 再生。
// モデルストリーム・TTS・再生・表情反映は DI(実 API/実エンジンなしで検証可・§4.4)。

/** モデルのテキストデルタを順次 yield するストリーム(実装は Claude streaming を注入)。 */
export type ModelStream = AsyncIterable<string>;

export interface VoiceChatDeps {
  tts: TtsEngine;
  voiceConfig: VoiceConfig;
  /** identity.json の neverCallsSelf(自称検知語・ハードコード禁止・§5.4)。 */
  neverCallsSelf: string[];
  /** 合成済み音声を再生キューへ(renderer 連携は呼び出し側)。 */
  onAudio: (wav: ArrayBuffer) => void;
  /** emotion 確定時に表情/スタイルへ反映(任意)。 */
  onEmotion?: (emotion: EmotionLabel) => void;
}

export interface VoiceChatResult {
  spokenText: string; // 実際に発話したテキスト(吹き出し表示にも使う)
  emotion: EmotionLabel;
  command?: OsCommand; // 喋り終わり後に実行(自称打ち切り時は付かない)
  blockedBySelfCheck: boolean; // C2 で自称検知し打ち切ったか
}

/**
 * モデルストリームを消費し、文単位で「自称検知 → 合成 → 再生」する。
 * 自称を検知した文は**発話せず**そこで打ち切る(発話済みは取り消せない=C2 の割り切り)。
 */
export async function runVoiceChat(
  stream: ModelStream,
  deps: VoiceChatDeps,
): Promise<VoiceChatResult> {
  const parser = createVoiceStreamParser();
  let emotion: EmotionLabel = 'neutral';
  let emotionEmitted = false;
  const spoken: string[] = [];
  let blocked = false;

  /** 1文を発話する。自称検知したら false(=打ち切り)。 */
  const speakSentence = async (s: string): Promise<boolean> => {
    if (detectAiSelfReference(s, deps.neverCallsSelf).detected) {
      blocked = true;
      return false;
    }
    const wav = await deps.tts.speak(s, resolveStyle(deps.voiceConfig, emotion));
    deps.onAudio(wav);
    spoken.push(s);
    return true;
  };

  /** チャンク(emotion＋文配列)を処理。打ち切りなら false。 */
  const handleChunk = async (em: EmotionLabel | undefined, sentences: string[]): Promise<boolean> => {
    if (em !== undefined && !emotionEmitted) {
      emotion = em;
      emotionEmitted = true;
      deps.onEmotion?.(em);
    }
    for (const s of sentences) {
      if (!(await speakSentence(s))) return false;
    }
    return true;
  };

  for await (const delta of stream) {
    const { emotion: em, sentences } = parser.push(delta);
    if (!(await handleChunk(em, sentences))) {
      return { spokenText: spoken.join(''), emotion, blockedBySelfCheck: true };
    }
  }

  const final = parser.flush();
  if (!(await handleChunk(undefined, final.sentences))) {
    return { spokenText: spoken.join(''), emotion, blockedBySelfCheck: true };
  }

  return { spokenText: spoken.join(''), emotion, command: final.command, blockedBySelfCheck: blocked };
}

import { detectAiSelfReference } from '../../shared/ai-self-check';
import { stripRuby, rubyToReading } from '../../shared/ruby';
import { resolveStyle } from './voice-loader';
import type { EmotionLabel } from '../../shared/types/animation';
import type { TtsEngine, VoiceConfig } from '../../shared/types/voice';

// 音声合成の唯一の消費器(task_17 C1/C2 / design-revision-voice §2,§3)。
//
// 文チャンク列を消費し、文単位で「自称検知(C2) → ルビ読み下し → 合成 → 送出」する。
// 「文をどう得るか(ソース)」だけが経路で異なるので、ソース生成は呼出側(voice-runtime)が用意して渡す:
//   - ストリーミング = Claude のデルタを json-stream-parser で逐次パースして文を yield。
//   - 確定発話       = 確定済みテキストを sentence-splitter で割り、1チャンクとして yield。
// 合成本体はここに1本化(分岐ごとの挙動ズレを防ぐ)。TTS・再生・表情反映は DI(実エンジン無しで検証可・§4.4)。

/** 発話ソースが出す1チャンク: emotion(最初の確定時のみ)＋その時点で完成した文の配列。 */
export interface SpeakChunk {
  emotion?: EmotionLabel;
  sentences: string[];
}

export interface VoiceChatDeps {
  tts: TtsEngine;
  voiceConfig: VoiceConfig;
  /** identity.json の neverCallsSelf(自称検知語・ハードコード禁止・§5.4)。空なら検知しない。 */
  neverCallsSelf: string[];
  /** 合成済み音声を再生キューへ(renderer 連携は呼出側)。text=この文の表示テキスト(再生同期の吹き出し用・呼出側は無視可)。 */
  onAudio: (wav: ArrayBuffer, text: string) => void;
  /** emotion 確定時に表情/スタイルへ反映(任意)。 */
  onEmotion?: (emotion: EmotionLabel) => void;
  /** 中断シグナル(投機キャンセル/supersede/barge-in)。abort されたら**それ以上音声を出さず**打ち切る。 */
  signal?: AbortSignal;
}

export interface VoiceChatResult {
  spokenText: string; // 実際に発話したテキスト(吹き出し表示にも使う)
  emotion: EmotionLabel;
  blockedBySelfCheck: boolean; // C2 で自称検知し打ち切ったか
  aborted: boolean; // 中断(投機キャンセル/supersede)で打ち切ったか
}

/**
 * 文チャンク列を消費し、文単位で「自称検知(C2) → ルビ読み下し → 合成 → 送出」する。
 * 自称を検知した文は発話せず打ち切る(発話済みは取り消せない=C2 の割り切り)。
 * 中断は throw せず aborted=true で返す。呼出側がストリーミングなら破棄(throw)、確定発話なら無言で終える。
 */
export async function speakChunks(
  source: AsyncIterable<SpeakChunk>,
  deps: VoiceChatDeps,
): Promise<VoiceChatResult> {
  let emotion: EmotionLabel = 'neutral';
  let emotionEmitted = false;
  const spoken: string[] = [];
  const done = (over: Partial<VoiceChatResult>): VoiceChatResult => ({
    spokenText: spoken.join(''),
    emotion,
    blockedBySelfCheck: false,
    aborted: false,
    ...over,
  });

  for await (const chunk of source) {
    if (chunk.emotion !== undefined && !emotionEmitted) {
      emotion = chunk.emotion;
      emotionEmitted = true;
      deps.onEmotion?.(emotion);
    }
    for (const s of chunk.sentences) {
      // ルビ(漢字《よみ》)は **表示・自称検知・記録は除去後**、**音声は読み下し**で扱う。
      const display = stripRuby(s);
      if (detectAiSelfReference(display, deps.neverCallsSelf).detected) return done({ blockedBySelfCheck: true });
      // 中断(投機キャンセル)済みなら、この文は合成も発話もしない(音声を漏らさない)。
      if (deps.signal?.aborted) return done({ aborted: true });
      // signal を合成HTTPへ渡す=中断時に進行中の合成も即打ち切り(孤児リクエストを残さない=詰まり防止)。
      const wav = await deps.tts.speak(rubyToReading(s), resolveStyle(deps.voiceConfig, emotion), deps.signal);
      if (deps.signal?.aborted) return done({ aborted: true }); // 合成中に中断されたら発話しない
      deps.onAudio(wav, display); // display=ルビ除去済の表示テキスト(再生同期で吹き出しに出す)
      spoken.push(display);
    }
  }
  return done({});
}

// テキストの文分割(task_17 C3 / design-revision-voice §2)。ストリーミング TTS のため、届いたバッファを
// 「TTS へ流せる完成文」と「未完の残り」に分ける。純粋関数(副作用なし)=単体テスト対象。
// **言語非依存**: 日本語(。！？)と英語(. ! ?)の両方を文末として扱う。半角ピリオド '.' は小数(3.14)・
// URL(example.com)・略語で誤区切りしやすいので「直後が空白/改行のときだけ」文末とみなす。読点(、)では区切らない。

/** 曖昧さなく即座に文末とみなす記号(全角句点/感嘆/疑問＋半角 ! ?)。 */
const HARD_SENTENCE_ENDERS = '。！？!?';

/**
 * buffer[i] が文末か。ハード記号(。！？!?)は即文末。半角ピリオド '.' は英語の文末のみ=**直後が空白/改行**の
 * ときに限る(小数/URL/略語を誤区切りしない)。'.' がバッファ末尾(直後不明)なら false=次の delta を待つ。
 */
function isSentenceEnd(buffer: string, i: number): boolean {
  const ch = buffer[i] ?? '';
  if (HARD_SENTENCE_ENDERS.includes(ch)) return true;
  if (ch === '.') {
    const next = buffer[i + 1];
    return next === ' ' || next === '\t' || next === '\n';
  }
  return false;
}

export interface SplitResult {
  /** TTS へ流せる完成文(末尾記号を含む・トリム済・空文字は除外)。 */
  complete: string[];
  /** まだ文末に達していない末尾(次の delta と連結する)。 */
  remainder: string;
}

/**
 * buffer を文単位に分割する。改行も文境界として扱う。
 * 連続する文末記号(例「！？」「。。」)は 1 つの境界にまとめる(細切れ発話を防ぐ)。
 */
export function splitSentences(buffer: string): SplitResult {
  const complete: string[] = [];
  let start = 0;
  let i = 0;
  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === '\n') {
      const s = buffer.slice(start, i).trim();
      if (s) complete.push(s);
      i += 1;
      start = i;
    } else if (isSentenceEnd(buffer, i)) {
      // 文末記号の連続をまとめて 1 文に含める。
      let j = i;
      while (j + 1 < buffer.length && isSentenceEnd(buffer, j + 1)) j += 1;
      const s = buffer.slice(start, j + 1).trim();
      if (s) complete.push(s);
      i = j + 1;
      start = i;
    } else {
      i += 1;
    }
  }
  return { complete, remainder: buffer.slice(start) };
}

export interface FirstChunkResult {
  /** 早期に発話する最初のチャンク(トリム済・空でない)。 */
  chunk: string;
  /** チャンク以降の残り(以後は splitSentences で文単位に戻す)。 */
  remainder: string;
}

/**
 * 第一声を早めるため、**最初の発話チャンクだけ**を早期に切り出す(B-06/施策A)。
 * 通常の文末(。！？!? と英語 '.')に加え、**読点(、)・改行・字数上限**でも区切る。2文目以降には使わない。
 *
 * ルビ保護:`《…》` の途中では切らない。また「基底+ルビ」が分断されないよう、
 *  - 字数上限での区切りは、直後が `《`(ルビ開始)でないルビ外の位置でのみ行う、
 *  - バッファ末尾(次の delta でルビが続くかもしれない位置)では字数上限区切りをしない。
 * これにより `漢字《よみ》` の読み下し(rubyToReading)を壊さない。
 *
 * 早期境界がまだ無ければ null(次の delta を待つ)。
 */
export function splitFirstChunk(buffer: string, maxChars: number): FirstChunkResult | null {
  let inRuby = false;
  let realChars = 0; // ルビ外の実文字数(区切り記号・空白を除く)
  for (let i = 0; i < buffer.length; i += 1) {
    const ch = buffer[i] ?? '';
    if (ch === '《') { inRuby = true; continue; }
    if (ch === '》') { inRuby = false; continue; }
    if (inRuby) continue;

    const isEnd = isSentenceEnd(buffer, i);
    const isBreak = isEnd || ch === '\n' || ch === '、';
    if (!isBreak && !/\s/.test(ch)) realChars += 1;

    // 句読点・改行:実文字が1つ以上あれば、ここで第一声を確定(ルビ安全)。
    if (isBreak && realChars >= 1) {
      let j = i;
      if (isEnd) while (j + 1 < buffer.length && isSentenceEnd(buffer, j + 1)) j += 1;
      const chunk = buffer.slice(0, j + 1).trim();
      if (chunk) return { chunk, remainder: buffer.slice(j + 1) };
    }

    // 字数上限:句読点が来なくてもルビ安全な位置で区切る。
    //  直後が `《`(ルビ開始)or バッファ末尾(続きが不明)のときは基底/ルビ分断を避けて待つ。
    if (realChars >= maxChars && i < buffer.length - 1 && buffer[i + 1] !== '《') {
      const chunk = buffer.slice(0, i + 1).trim();
      if (chunk) return { chunk, remainder: buffer.slice(i + 1) };
    }
  }
  return null;
}

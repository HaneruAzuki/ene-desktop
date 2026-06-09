// 日本語テキストの文分割(task_17 C3 / design-revision-voice §2)。
// ストリーミング TTS のため、届いたバッファを「TTS へ流せる完成文」と「未完の残り」に分ける。
// 純粋関数(副作用なし)=単体テスト対象。

/** 文末とみなす記号(全角・半角の句点/感嘆/疑問)。読点(、)では区切らない。 */
const SENTENCE_END = '。！？!?';

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
    } else if (SENTENCE_END.includes(ch)) {
      // 文末記号の連続をまとめて 1 文に含める。
      let j = i;
      while (j + 1 < buffer.length && SENTENCE_END.includes(buffer[j + 1])) j += 1;
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
 * 通常の文末(。！？!?)に加え、**読点(、)・改行・字数上限**でも区切る。2文目以降には使わない。
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

    const isEnd = SENTENCE_END.includes(ch);
    const isBreak = isEnd || ch === '\n' || ch === '、';
    if (!isBreak && !/\s/.test(ch)) realChars += 1;

    // 句読点・改行:実文字が1つ以上あれば、ここで第一声を確定(ルビ安全)。
    if (isBreak && realChars >= 1) {
      let j = i;
      if (isEnd) while (j + 1 < buffer.length && SENTENCE_END.includes(buffer[j + 1] ?? '')) j += 1;
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

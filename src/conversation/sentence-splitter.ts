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

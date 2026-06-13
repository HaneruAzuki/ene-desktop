import { type EmotionLabel } from '../shared/types/animation';
import type { OsCommand } from '../shared/types/os';
import { splitSentences, splitFirstChunk } from './sentence-splitter';
import { FIRST_CHUNK_MAX_CHARS } from '../shared/constants';
import { normalizeEmotion, parseOsCommand } from '../shared/llm-parse';

// JSON応答のストリーミング解釈(C1・B-06)。`runVoiceChat` が使う VoiceStreamParser を満たす。
//
// 契約は非ストリーミングと同一の JSON 1個:
//   {"type":"chat","emotion":"neutral","message":"…(青空文庫式ルビ込み)…"}
//   {"type":"os_command","emotion":"...","message":"…","command":{...}}
// emotion を message より前に置く前提(プロンプトで指示)で、最初の声までに emotion を確定できる。
// message の文字列値を逐次取り出し、文単位に分割して TTS へ流す(JSON エスケープを解く)。
// ルビ(漢字《よみ》)は message 本文にそのまま含まれ、文単位で TTS 側(runVoiceChat)が解決する。
//
// 純粋ロジック(I/O 無し)=単体テスト対象。

/** push の戻り値。確定した emotion(最初の一度だけ)と、今回確定した発話文。 */
export interface StreamChunk {
  emotion?: EmotionLabel;
  sentences: string[];
}

/** flush の戻り値。残っていた最終文と、末尾トレーラの OS コマンド/傾聴入室フラグ(妥当な場合のみ)。 */
export interface StreamFinal {
  sentences: string[];
  command?: OsCommand;
  enterListening?: boolean;
}

export interface VoiceStreamParser {
  /** テキストデルタを与え、確定した emotion / 発話文を得る。 */
  push(delta: string): StreamChunk;
  /** ストリーム終端。残りの文と OS コマンドを得る。 */
  flush(): StreamFinal;
}

const MSG_OPEN_RE = /"message"\s*:\s*"/;
const EMOTION_RE = /"emotion"\s*:\s*"([^"]*)"/;
const ENTER_LISTENING_RE = /"enterListening"\s*:\s*true/; // 傾聴入室(listening-mode・true のみ拾う)

/** tail(message 終了後の生バッファ)から command を取り出して検証する。 */
function parseCommandFromTail(tail: string): OsCommand | undefined {
  const key = tail.indexOf('"command"');
  if (key === -1) return undefined;
  const open = tail.indexOf('{', key);
  if (open === -1) return undefined;
  let depth = 0;
  for (let i = open; i < tail.length; i += 1) {
    if (tail[i] === '{') depth += 1;
    else if (tail[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return parseOsCommand(JSON.parse(tail.slice(open, i + 1)));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export function createJsonStreamParser(): VoiceStreamParser {
  let phase: 'head' | 'message' | 'tail' = 'head';
  let head = ''; // message 開始前の生バッファ(type/emotion を含む)
  let tail = ''; // message 終了後の生バッファ(command 抽出用)
  let sentenceBuf = ''; // 未確定の発話文(unescape 済)
  let escaped = false;
  let inUnicode = false;
  let uniBuf = '';
  let emotionEmitted = false;
  let firstChunkDone = false; // 第一声(最初のチャンク)を早期発話したか(施策A)
  let enterListening = false; // 傾聴入室フラグ(message 前=head / 後=tail のどちらでも拾う)

  /** message 文字列の 1 文字を処理。閉じ引用符に達したら true(=message 終了)。 */
  function feedChar(c: string): boolean {
    if (inUnicode) {
      uniBuf += c;
      if (uniBuf.length === 4) {
        const code = parseInt(uniBuf, 16);
        if (!Number.isNaN(code)) sentenceBuf += String.fromCharCode(code);
        inUnicode = false;
        uniBuf = '';
      }
      return false;
    }
    if (escaped) {
      escaped = false;
      switch (c) {
        case 'n': sentenceBuf += '\n'; break;
        case 't': sentenceBuf += '\t'; break;
        case 'r': sentenceBuf += '\r'; break;
        case 'b': sentenceBuf += '\b'; break;
        case 'f': sentenceBuf += '\f'; break;
        case 'u': inUnicode = true; uniBuf = ''; break;
        default: sentenceBuf += c; // " \ / など
      }
      return false;
    }
    if (c === '\\') { escaped = true; return false; }
    if (c === '"') return true; // message 値の終了
    sentenceBuf += c;
    return false;
  }

  /**
   * sentenceBuf から発話可能なチャンクを取り出す(未完の末尾は残す)。
   * 第一声(最初のチャンク)だけは施策A=読点/改行/字数でも早期に切り出して声を早める。
   * それ以降は通常の文単位(splitSentences)。
   */
  function drain(): string[] {
    if (!firstChunkDone) {
      const first = splitFirstChunk(sentenceBuf, FIRST_CHUNK_MAX_CHARS);
      if (!first) return []; // まだ第一声の境界(句読点/改行/字数上限)に未達
      firstChunkDone = true;
      sentenceBuf = first.remainder;
      // 残りに既に完成文が含まれていれば続けて取り出す。
      const { complete, remainder } = splitSentences(sentenceBuf);
      sentenceBuf = remainder;
      return [first.chunk, ...complete];
    }
    const { complete, remainder } = splitSentences(sentenceBuf);
    sentenceBuf = remainder;
    return complete;
  }

  /** message 範囲の文字列を流し込む。閉じ引用符以降は tail へ。 */
  function feedMessageRange(str: string): string[] {
    for (let i = 0; i < str.length; i += 1) {
      if (feedChar(str[i] ?? '')) {
        phase = 'tail';
        tail += str.slice(i + 1);
        return drain();
      }
    }
    return drain();
  }

  return {
    push(delta: string): StreamChunk {
      if (phase === 'tail') {
        tail += delta;
        return { sentences: [] };
      }
      if (phase === 'message') {
        return { sentences: feedMessageRange(delta) };
      }
      // phase === 'head'
      head += delta;
      if (!enterListening && ENTER_LISTENING_RE.test(head)) enterListening = true;
      let emotion: EmotionLabel | undefined;
      if (!emotionEmitted) {
        const em = EMOTION_RE.exec(head);
        if (em) {
          emotion = normalizeEmotion((em[1] ?? '').trim());
          emotionEmitted = true; // 解決済(値が許可外でも再探索しない)
        }
      }
      const m = MSG_OPEN_RE.exec(head);
      if (!m) return emotion ? { emotion, sentences: [] } : { sentences: [] };
      // message 値の開始引用符の直後から message 処理へ移行。
      const after = head.slice(m.index + m[0].length);
      phase = 'message';
      head = '';
      const sentences = feedMessageRange(after);
      return emotion ? { emotion, sentences } : { sentences };
    },

    flush(): StreamFinal {
      const sentences: string[] = [];
      const last = sentenceBuf.trim();
      if (last) sentences.push(last);
      sentenceBuf = '';
      const command = phase === 'tail' ? parseCommandFromTail(tail) : undefined;
      if (!enterListening && ENTER_LISTENING_RE.test(tail)) enterListening = true;
      return {
        sentences,
        ...(command ? { command } : {}),
        ...(enterListening ? { enterListening: true } : {}),
      };
    },
  };
}

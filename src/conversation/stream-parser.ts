import { EMOTION_LABELS, type EmotionLabel } from '../shared/types/animation';
import type { OsAction, OsCommand } from '../shared/types/os';
import { splitSentences } from './sentence-splitter';

// C1: 音声応答のストリーミング書式を逐次解釈する(design-revision-voice §2)。
//
// 書式(暫定・実モデルでのスパイク後に確定):
//   [[emotion:LABEL]]    ← 先頭・任意。許可外/欠落は emotion 無し(表示側で neutral・F-ANIM-06)
//   本文…                 ← プレーンテキスト。文単位で push が返す → TTS キューへ
//   [[os_command:{...}]]  ← 末尾・任意。喋り終わり後に実行(現状の実行タイミングと整合)
//
// なぜストリーミング専用パーサが要るか:現行の非ストリーミング JSON 契約
// ({type,message,emotion})を素直に stream すると半端 JSON になり、文単位 TTS に渡せない(C1)。
// 純粋ロジック(I/O 無し)=単体テスト対象。

const EMO_RE = /^\s*\[\[emotion:([^\]]*)\]\]/;
const EMO_OPEN = '[[emotion:';
const CMD_OPEN = '[[os_command:';
const SENTINEL_CLOSE = ']]';
const VALID_ACTIONS: readonly OsAction[] = ['open_notepad', 'open_browser', 'open_folder'];

/** push の戻り値。確定した emotion(最初の一度だけ)と、今回確定した発話文。 */
export interface StreamChunk {
  emotion?: EmotionLabel;
  sentences: string[];
}

/** flush の戻り値。残っていた最終文と、末尾トレーラの OS コマンド(妥当な場合のみ)。 */
export interface StreamFinal {
  sentences: string[];
  command?: OsCommand;
}

export interface VoiceStreamParser {
  /** テキストデルタを与え、確定した emotion / 発話文を得る。 */
  push(delta: string): StreamChunk;
  /** ストリーム終端。残りの文と OS コマンドを得る。 */
  flush(): StreamFinal;
}

/** emotion ラベルを許可集合へ正規化(許可外・欠落は undefined)。 */
function normalizeEmotion(v: string): EmotionLabel | undefined {
  return (EMOTION_LABELS as readonly string[]).includes(v) ? (v as EmotionLabel) : undefined;
}

interface EmotionResolution {
  resolved: boolean;
  emotion?: EmotionLabel;
  rest?: string;
}

/**
 * 先頭の emotion sentinel を解決する。
 * - 完成して含む → resolved:true・emotion 抽出・rest=以降
 * - まだ途中(部分一致)→ resolved:false(次の delta を待つ)
 * - 明確に sentinel でない → resolved:true・emotion:undefined・rest=buf
 */
function tryConsumeEmotion(buf: string): EmotionResolution {
  const m = EMO_RE.exec(buf);
  if (m) {
    return { resolved: true, emotion: normalizeEmotion(m[1].trim()), rest: buf.slice(m[0].length) };
  }
  const trimmed = buf.replace(/^\s+/, '');
  // 受信途中: "[[emo" のような接頭辞か、"[[emotion:joy"(閉じ ]] 未到達)
  if (EMO_OPEN.startsWith(trimmed) || trimmed.startsWith(EMO_OPEN)) {
    return { resolved: false };
  }
  return { resolved: true, emotion: undefined, rest: buf };
}

/** buffer 末尾が CMD_OPEN の「真の接頭辞」である長さ(発話中に部分 sentinel を喋らないため保留)。 */
function partialSentinelSuffixLen(buf: string): number {
  const max = Math.min(buf.length, CMD_OPEN.length - 1);
  for (let k = max; k > 0; k -= 1) {
    if (buf.slice(buf.length - k) === CMD_OPEN.slice(0, k)) return k;
  }
  return 0;
}

/** 末尾トレーラ(commandBuf)から OS コマンドを取り出して検証する。 */
function parseCommand(raw: string): OsCommand | undefined {
  const start = raw.indexOf(CMD_OPEN);
  if (start === -1) return undefined;
  let json = raw.slice(start + CMD_OPEN.length);
  const close = json.lastIndexOf(SENTINEL_CLOSE);
  if (close !== -1) json = json.slice(0, close);
  try {
    const obj: unknown = JSON.parse(json.trim());
    if (typeof obj !== 'object' || obj === null) return undefined;
    const o = obj as Record<string, unknown>;
    if (typeof o.action !== 'string' || !VALID_ACTIONS.includes(o.action as OsAction)) return undefined;
    if ((o.action === 'open_browser' || o.action === 'open_folder') && typeof o.target !== 'string') {
      return undefined;
    }
    const cmd: OsCommand = { action: o.action as OsAction };
    if (typeof o.target === 'string') cmd.target = o.target;
    return cmd;
  } catch {
    return undefined;
  }
}

/** ストリーミング応答パーサを生成する(状態をクロージャに閉じ込める)。 */
export function createVoiceStreamParser(): VoiceStreamParser {
  let buffer = '';
  let commandBuf = '';
  let emotionDone = false;
  let inCommand = false;

  return {
    push(delta: string): StreamChunk {
      if (inCommand) {
        commandBuf += delta;
        return { sentences: [] };
      }
      buffer += delta;

      let emotion: EmotionLabel | undefined;
      if (!emotionDone) {
        const r = tryConsumeEmotion(buffer);
        if (!r.resolved) return { sentences: [] };
        emotionDone = true;
        emotion = r.emotion;
        buffer = r.rest ?? buffer;
      }

      // 末尾コマンドの開始を検出したら、それ以前を本文として確定する。
      const cmdIdx = buffer.indexOf(CMD_OPEN);
      if (cmdIdx !== -1) {
        const body = buffer.slice(0, cmdIdx);
        commandBuf = buffer.slice(cmdIdx);
        inCommand = true;
        const { complete, remainder } = splitSentences(body);
        buffer = remainder; // 未完の最終文は flush で出す
        return { emotion, sentences: complete };
      }

      // 末尾が部分 sentinel(例 "[[os_comm")なら保留し、本文として喋らない。
      const hold = partialSentinelSuffixLen(buffer);
      const head = hold > 0 ? buffer.slice(0, buffer.length - hold) : buffer;
      const heldTail = hold > 0 ? buffer.slice(buffer.length - hold) : '';
      const { complete, remainder } = splitSentences(head);
      buffer = remainder + heldTail;
      return { emotion, sentences: complete };
    },

    flush(): StreamFinal {
      const sentences: string[] = [];
      if (inCommand) {
        const last = buffer.trim();
        if (last) sentences.push(last);
        buffer = '';
        return { sentences, command: parseCommand(commandBuf) };
      }
      // emotion 未解決のまま終了(極短/部分 sentinel)→ buffer 全体を本文として救済。
      emotionDone = true;
      const last = buffer.trim();
      if (last) sentences.push(last);
      buffer = '';
      return { sentences };
    },
  };
}

import { EMOTION_LABELS, type EmotionLabel } from './types/animation';
import type { OsAction, OsCommand } from './types/os';

// LLM 応答パースの共有ヘルパ(設計書 §3.4)。
// Conversation / Memory / Router の各所で重複していた「JSON 抽出・emotion 正規化・
// OS コマンド検証・文字列配列化」を1か所に集約する(振る舞いは従来の各コピーと同一)。

/**
 * コードフェンス・前後テキストを除去して最初の JSON オブジェクトを抽出・パースする。
 * - 先頭の ```json / ``` フェンスを剥がす
 * - 最初の '{' から最後の '}' までを切り出す(前後のテキスト混入を救済)
 * - パース失敗・範囲不正は null
 */
export function extractJsonObject(raw: string): unknown | null {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  text = text.slice(first, last + 1);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** emotion ラベルを許可集合へ正規化(許可外・欠落は undefined → 表示側で neutral・F-ANIM-06)。 */
export function normalizeEmotion(v: string): EmotionLabel | undefined {
  return (EMOTION_LABELS as readonly string[]).includes(v) ? (v as EmotionLabel) : undefined;
}

/** OS action のホワイトリスト(設計書 §3.5・OsAction 型から導出)。 */
export const VALID_OS_ACTIONS: readonly OsAction[] = ['open_notepad', 'open_browser', 'open_folder'];

/**
 * 任意のパース済みオブジェクトから OS コマンドを取り出して検証する。
 * - action がホワイトリスト内であること
 * - open_browser / open_folder は target(文字列)が必須
 * - 不正なら undefined
 */
export function parseOsCommand(obj: unknown): OsCommand | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const o = obj as Record<string, unknown>;
  if (typeof o.action !== 'string' || !VALID_OS_ACTIONS.includes(o.action as OsAction)) return undefined;
  if ((o.action === 'open_browser' || o.action === 'open_folder') && typeof o.target !== 'string') {
    return undefined;
  }
  const cmd: OsCommand = { action: o.action as OsAction };
  if (typeof o.target === 'string') cmd.target = o.target;
  return cmd;
}

/** 文字列配列に正規化(string 以外は捨てる)。 */
export function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

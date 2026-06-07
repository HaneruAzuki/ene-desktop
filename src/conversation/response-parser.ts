import type { ConversationResponse } from '../shared/types/conversation';
import type { OsAction } from '../shared/types/os';
import { EMOTION_LABELS, type EmotionLabel } from '../shared/types/animation';

// JSON 応答パースの三段構え(設計書 §3.4「パース成功率の三段構え」)。
// zod 等は使わず手書きの型ガードで検証する。

const VALID_ACTIONS: readonly OsAction[] = ['open_notepad', 'open_browser', 'open_folder'];

/** emotion を許可ラベルに正規化(許可外・欠落は undefined → 表示側で neutral・F-ANIM-06)。 */
function normalizeEmotion(v: unknown): EmotionLabel | undefined {
  return typeof v === 'string' && (EMOTION_LABELS as readonly string[]).includes(v)
    ? (v as EmotionLabel)
    : undefined;
}

function isValidResponse(obj: unknown): obj is ConversationResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;

  if (o.type === 'chat') {
    return typeof o.message === 'string';
  }

  if (o.type === 'os_command') {
    if (typeof o.message !== 'string') return false;
    if (typeof o.command !== 'object' || o.command === null) return false;
    const cmd = o.command as Record<string, unknown>;
    if (typeof cmd.action !== 'string') return false;
    if (!VALID_ACTIONS.includes(cmd.action as OsAction)) return false;
    // open_browser / open_folder は target(文字列)が必須
    if (cmd.action === 'open_browser' || cmd.action === 'open_folder') {
      if (typeof cmd.target !== 'string') return false;
    }
    return true;
  }

  return false;
}

export function parseConversationResponse(raw: string): ConversationResponse | null {
  let text = raw.trim();

  // 1. コードフェンス除去
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // 2. JSON 範囲抽出(前後のテキスト混入を救済)
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
  text = text.slice(firstBrace, lastBrace + 1);

  // 3. パース + 型ガード検証
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isValidResponse(parsed)) return null;
    // chat は emotion(任意)を許可ラベルへ正規化して付与する(task_13)。
    if (parsed.type === 'chat') {
      const emotion = normalizeEmotion((parsed as Record<string, unknown>).emotion);
      return emotion ? { ...parsed, emotion } : { type: 'chat', message: parsed.message };
    }
    return parsed;
  } catch {
    return null;
  }
}

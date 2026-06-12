import type { ConversationResponse } from '../shared/types/conversation';
import type { OsAction } from '../shared/types/os';
import { extractJsonObject, normalizeEmotion, VALID_OS_ACTIONS } from '../shared/llm-parse';
import { stripRuby, rubyToReading } from './ruby';

// JSON 応答パースの三段構え(設計書 §3.4「パース成功率の三段構え」)。
// zod 等は使わず手書きの型ガードで検証する。

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
    if (!VALID_OS_ACTIONS.includes(cmd.action as OsAction)) return false;
    // open_browser / open_folder は target(文字列)が必須
    if (cmd.action === 'open_browser' || cmd.action === 'open_folder') {
      if (typeof cmd.target !== 'string') return false;
    }
    return true;
  }

  return false;
}

export function parseConversationResponse(raw: string): ConversationResponse | null {
  // コードフェンス除去 + JSON 範囲抽出(前後のテキスト混入を救済)+ パース。
  const parsed = extractJsonObject(raw);
  if (!isValidResponse(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  // Claude振り仮名方式:message に青空文庫式ルビ(漢字《よみ》)が埋め込まれる。
  //  - 表示用 message = ルビを除去した素の漢字かな交じり。
  //  - reading(音声用)= ルビを解決した読み下しテキスト(ルビが無ければ undefined=message を読む)。
  const display = stripRuby(parsed.message);
  const ttsText = rubyToReading(parsed.message);
  const reading = ttsText !== display ? ttsText : undefined;
  // chat は emotion(任意)を許可ラベルへ正規化して付与する(task_13)。
  if (parsed.type === 'chat') {
    const emotion = typeof o.emotion === 'string' ? normalizeEmotion(o.emotion) : undefined;
    return {
      type: 'chat',
      message: display,
      ...(emotion ? { emotion } : {}),
      ...(reading ? { reading } : {}),
    };
  }
  return { ...parsed, message: display, ...(reading ? { reading } : {}) };
}

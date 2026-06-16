import type { ConversationResponse } from '../shared/types/conversation';
import { extractJsonObject, normalizeEmotion } from '../shared/llm-parse';
import { stripRuby, rubyToReading } from '../voice/ruby';

// JSON 応答パースの三段構え(設計書 §3.4「パース成功率の三段構え」)。
// zod 等は使わず手書きの型ガードで検証する。

function isValidResponse(obj: unknown): obj is ConversationResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return o.type === 'chat' && typeof o.message === 'string';
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
  // emotion(任意)を許可ラベルへ正規化して付与する(task_13)。
  const emotion = typeof o.emotion === 'string' ? normalizeEmotion(o.emotion) : undefined;
  const enterListening = o.enterListening === true; // 傾聴入室(listening-mode・明示宣言時のみ)
  return {
    type: 'chat',
    message: display,
    ...(emotion ? { emotion } : {}),
    ...(reading ? { reading } : {}),
    ...(enterListening ? { enterListening: true } : {}),
  };
}

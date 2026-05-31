import type { OsCommand } from './os';

// Conversation Layer の型定義(設計書 §3.4)。

export type ConversationResponse =
  | { type: 'chat'; message: string }
  | { type: 'os_command'; message: string; command: OsCommand };

/** Claude へ渡すメッセージ1件(role + 文字列 content)。 */
export interface PromptMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** buildPrompt の戻り値。 */
export interface BuiltPrompt {
  system: string;
  messages: PromptMessage[];
}

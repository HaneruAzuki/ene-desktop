import type { OsCommand } from './os';
import type { EmotionLabel } from './animation';

// Conversation Layer の型定義(設計書 §3.4 / task_14 / task_16)。

export type ConversationResponse =
  // message=表示(漢字かな交じり・ルビ除去済) / reading=音声読み上げ用テキスト
  //  Claude は message に青空文庫式ルビ「漢字《よみ》」を埋め、パーサが表示用(stripRuby)と
  //  音声用(rubyToReading)へ分解する。reading はルビがある時だけ付与(欠落時は message を読む)。
  | { type: 'chat'; message: string; reading?: string; emotion?: EmotionLabel } // emotion は task_13(任意・1ターン揮発)
  | { type: 'os_command'; message: string; reading?: string; command: OsCommand };

/**
 * Claude へ渡すメッセージ1件(role + 文字列 content)。
 * task_14: `cacheable` を立てたメッセージは、SDK へ渡す際に content をブロック化し
 * `cache_control` を付与する(履歴キャッシュの境界)。
 */
export interface PromptMessage {
  role: 'user' | 'assistant';
  content: string;
  cacheable?: boolean;
}

/**
 * system プロンプトのブロック(task_14)。
 * 先頭に Tier0(不変・cacheable=true)を置き、以降に準不変ブロックを並べる。
 * `cacheable` を立てたブロックの末尾に `cache_control` を付ける(キャッシュ境界)。
 */
export interface SystemBlock {
  type: 'text';
  text: string;
  cacheable?: boolean;
}

/** buildPrompt の戻り値。system は Tier 順のブロック配列(task_14)。 */
export interface BuiltPrompt {
  system: SystemBlock[];
  messages: PromptMessage[];
}

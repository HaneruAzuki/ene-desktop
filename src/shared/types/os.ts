// OS Integration Layer の型定義(設計書 §3.5)。
// ConversationResponse の os_command からも参照されるため shared/types に置く。

// MVP で対応する action は固定の3種類のみ(ホワイトリスト・設計書 §3.5)。
export type OsAction = 'open_notepad' | 'open_browser' | 'open_folder';

export interface OsCommand {
  action: OsAction;
  target?: string; // open_browser: URL / open_folder: 絶対パス / open_notepad: 不要
}

export interface OsCommandResult {
  success: boolean;
  message?: string; // ユーザーに見せるキャラ口調メッセージ
  error?: string; // ログ用の技術的エラー(ユーザーには見せない)
}

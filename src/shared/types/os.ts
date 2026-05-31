// OS Integration Layer の型定義(設計書 §3.5)。
// ConversationResponse の os_command からも参照されるため shared/types に置く。

// MVP で対応する action は固定の3種類のみ(ホワイトリスト・設計書 §3.5)。
export type OsAction = 'open_notepad' | 'open_browser' | 'open_folder';

export interface OsCommand {
  action: OsAction;
  target?: string; // open_browser: URL / open_folder: 絶対パス / open_notepad: 不要
}

// 実行失敗の理由(キャラ口調フォールバック文言の選択に使う・task_06 §5)。
export type OsCommandFailureReason =
  | 'invalid_action'
  | 'invalid_target'
  | 'path_traversal'
  | 'outside_home'
  | 'non_https'
  | 'exec_error';

export interface OsCommandResult {
  ok: boolean;
  message?: string; // 実行失敗時のキャラ口調フォールバック文言(成功時は会話側の message を優先)
  reason?: OsCommandFailureReason;
}

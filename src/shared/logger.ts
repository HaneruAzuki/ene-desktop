// ロガー(設計書 §6.2 / CLAUDE.md §8.3)。
//
// task_00 では electron-log への依存を持たない最小スタブとして実装する
// (electron-log の配線・出力先設定は main process 側の後続タスクで行う)。
// インターフェースは後続タスクで変えずに中身だけ差し替えられるよう固定する。
//
// 📌 重要(設計書 §6.2 / CLAUDE.md §6 禁止リスト):
//    いずれのレベルでも、ユーザー入力・AI 応答・プロンプト全文・記憶内容などの
//    個人情報は記録しないこと。記録するのは「何が起きたか」のメタ情報のみ。

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

function emit(level: LogLevel, message: string, ...meta: unknown[]): void {
  const line = `[${level}] ${message}`;
  // eslint-disable-next-line no-console -- スタブ実装。後続タスクで electron-log に置換する。
  switch (level) {
    case 'error':
      console.error(line, ...meta);
      break;
    case 'warn':
      console.warn(line, ...meta);
      break;
    default:
      console.log(line, ...meta);
      break;
  }
}

export const logger = {
  error: (message: string, ...meta: unknown[]): void => emit('error', message, ...meta),
  warn: (message: string, ...meta: unknown[]): void => emit('warn', message, ...meta),
  info: (message: string, ...meta: unknown[]): void => emit('info', message, ...meta),
  debug: (message: string, ...meta: unknown[]): void => emit('debug', message, ...meta),
};

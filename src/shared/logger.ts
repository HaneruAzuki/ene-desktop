import { join } from 'node:path';

// ロガー(設計書 §6.2 / CLAUDE.md §8.3)。electron-log をラップした薄い API。
//
// 📌 重要(設計書 §6.2 / CLAUDE.md §12 禁止リスト):
//    会話内容・AI 応答・プロンプト全文・記憶コンテキスト等の個人情報は記録しない。
//    記録するのは「何が起きたか」のメタ情報のみ
//    (例: Router 判定ドメイン名・API 応答時間・エラー種別)。
//
// electron-log/main は Electron(main process)環境でのみ正しく動作するため、
// 利用できない環境(Vitest など)では console にフォールバックする。

type LogFn = (msg: string, meta?: object) => void;
interface LogBackend {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

let backend: LogBackend | null = null;

function resolveBackend(): LogBackend {
  if (backend) return backend;
  try {
    // electron-vite が main を CommonJS で出力するため require が使える。
    // 非 Electron 環境では require 自体が無いか electron-log/main の読込に失敗する。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron-log/main');
    backend = (mod.default ?? mod) as LogBackend;
  } catch {
    // フォールバック(テスト等)。
    backend = {
      error: (...a) => console.error(...a),
      warn: (...a) => console.warn(...a),
      info: (...a) => console.info(...a),
      debug: (...a) => console.debug(...a),
    };
  }
  return backend;
}

function emit(level: keyof LogBackend, msg: string, meta?: object): void {
  const b = resolveBackend();
  if (meta === undefined) {
    b[level](msg);
  } else {
    b[level](msg, meta);
  }
}

export const log: {
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
} = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
};

/**
 * ログ出力先をポータブルデータ配下(data/logs/main.log)に設定する。
 * main process の起動時に getLogsDir() を渡して呼ぶ想定(task_07/10 で配線)。
 * 非 Electron 環境では何もしない。
 */
export function initLogger(logsDir: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron-log/main');
    const elog = mod.default ?? mod;
    elog.transports.file.resolvePathFn = (): string => join(logsDir, 'main.log');
    elog.initialize?.();
  } catch {
    // テスト等では何もしない
  }
}

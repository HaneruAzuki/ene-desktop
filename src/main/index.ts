import { app, type BrowserWindow } from 'electron';
import { log } from '../shared/logger';
import { acquireSingleInstanceLock } from './single-instance';
import { runStartupSequence } from './lifecycle';
import { runShutdownSequence } from './shutdown';
import type { AppRuntime } from './ipc';

// Electron main エントリポイント(設計書 §7)。
// 多重起動防止 → 起動シーケンス(lifecycle)→ 終了時に記憶抽出(shutdown)。

const runtime: AppRuntime = {
  charContext: null,
  apiKey: null,
  initialGreeting: null,
  tts: null,
  voiceConfig: null,
};
let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;

async function start(): Promise<void> {
  try {
    const result = await runStartupSequence(runtime);
    mainWindow = result.mainWindow;
  } catch (e) {
    // 起動シーケンス内で app.quit() 済み。ここではログのみ。
    log.error('startup failed', { name: (e as Error).name });
    app.quit();
  }
}

if (!acquireSingleInstanceLock()) {
  // 既に別プロセスが起動中 → 静かに終了(設計書 §7.1)
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  // 終了前に記憶抽出 + 短期記憶クリア(設計書 §7.2)。
  // preventDefault して非同期処理を待ってから quit する。
  app.on('before-quit', (event) => {
    if (!shuttingDown && runtime.apiKey) {
      event.preventDefault();
      shuttingDown = true;
      void runShutdownSequence(runtime).finally(() => app.quit());
    }
  });

  void start();
}

import { app, type BrowserWindow } from 'electron';
import { log, initLogger } from '../shared/logger';
import { getLogsDir } from '../storage/paths';
import { acquireSingleInstanceLock } from './single-instance';
import { createMainWindow } from './window';
import { createTray } from './tray';
import { registerIpcHandlers, type AppRuntime } from './ipc';
import {
  loadWindowPosition,
  getDefaultPosition,
  clampPositionToScreen,
  saveWindowPosition,
} from './window-position';
import { buildCharacterContext } from '../character/context-builder';
import { loadAndDecryptApiKey } from '../storage/encryption';
import { openApiKeyDialog } from './api-key-dialog';

// Electron main エントリポイント(設計書 §7)。
// task_07 では window / tray / IPC の最小統合 + charContext・apiKey の最小ロードまで。
// クラウド警告・APIキーダイアログ・誕生日チェック・挨拶などの完全な起動シーケンスは task_10。

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  await app.whenReady();
  initLogger(getLogsDir());
  log.info('app starting');

  // 実行時状態(task_10 で完全に構築)。失敗しても起動は継続する。
  const runtime: AppRuntime = { charContext: null, apiKey: null };
  try {
    runtime.charContext = await buildCharacterContext();
  } catch (e) {
    log.error('failed to build character context', { name: (e as Error).name });
  }
  try {
    runtime.apiKey = await loadAndDecryptApiKey();
  } catch (e) {
    log.warn('failed to load api key', { name: (e as Error).name });
  }

  // ウィンドウ位置(前回位置を復元 → 画面内補正 / 無ければ右下既定)
  const saved = await loadWindowPosition();
  const position = saved ? clampPositionToScreen(saved) : getDefaultPosition();
  mainWindow = createMainWindow(position);
  await saveWindowPosition(position.x, position.y);

  createTray(mainWindow);
  registerIpcHandlers(mainWindow, runtime);

  // F-KEY-03: APIキー未保存なら設定ダイアログを表示する。
  // (クラウド警告・キャンセル時終了などを含む完全な起動シーケンスは task_10 で統合)
  if (!runtime.apiKey) {
    void openApiKeyDialog(mainWindow, (key) => {
      runtime.apiKey = key;
    });
  }

  log.info('app ready');
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

  void bootstrap();
}

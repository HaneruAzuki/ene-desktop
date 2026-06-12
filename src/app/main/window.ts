import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { WINDOW_WIDTH, WINDOW_HEIGHT } from '../../shared/constants';
import type { Position } from './window-position';

// 透過ウィンドウの作成(設計書 §8.1 / §4.4)。

export function createMainWindow(position?: Position): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: position?.x,
    y: position?.y,
    // 透過ウィンドウ設定(設計書 §8.1)
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true, // タスクバーに出さない(タスクトレイ運用)
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // マイク権限(getUserMedia)のみ許可する(task_17 Phase B・音声入力)。
  // 対象はローカルの自アプリのみ。録音音声はローカル STT(main)にしか使わない(§4.2/§7.1)。
  // media 以外の権限(通知・位置情報等)は一切使わないため拒否する(最小権限)。
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  // 開発時は dev サーバ URL、本番時は out/renderer/index.html を読み込む。
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

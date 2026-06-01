import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { WINDOW_WIDTH, WINDOW_HEIGHT } from '../shared/constants';
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

  // 開発時は dev サーバ URL、本番時は out/renderer/index.html を読み込む。
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

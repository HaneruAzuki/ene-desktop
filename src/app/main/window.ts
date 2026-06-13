import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { WINDOW_WIDTH, WINDOW_HEIGHT } from '../../shared/constants';
import { getTrayIconPath } from '../../shared/node/paths';
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
    skipTaskbar: false, // 常にタスクバーに表示(トレイは廃止・UI改修 段階4。最小化/復帰・右クリック終了の入口にする)
    icon: getTrayIconPath(), // タスクバーボタンのアイコン
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

  // 開発時のみ: DevTools を「別ウィンドウ(detach)」で開く。
  // 本ウィンドウは frame:false・transparent・小サイズのため、既定のドッキング表示だと
  // DevTools が窓の内側に固定されて外へ出せず使い物にならない。Ctrl+Shift+I / F12 を横取りし、
  // 既定のドッキング動作(preventDefault)を止めて detach モードでトグルする。
  if (rendererUrl) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      const isToggle = (input.control && input.shift && key === 'i') || key === 'f12';
      if (!isToggle) return;
      event.preventDefault();
      const wc = win.webContents;
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
    });
  }

  return win;
}

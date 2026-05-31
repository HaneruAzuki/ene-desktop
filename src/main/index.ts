import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

// task_00 では「空の透過ウィンドウが起動する」最小構成のみを実装する。
// 多重起動防止・記憶・APIキー等のライフサイクル処理は後続タスクで追加する。

const WINDOW_WIDTH = 240;
const WINDOW_HEIGHT = 320;

function createWindow(): void {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    // 透過ウィンドウ設定(設計書 §4.4 / §8.1)
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // 開発時は electron-vite が dev サーバの URL を環境変数で渡す。
  // 本番時は out/renderer/index.html を直接読み込む。
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  createWindow();

  app.on('activate', () => {
    // macOS 互換(MVP は Windows 専用だが Electron の慣習に従う)
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

void bootstrap();

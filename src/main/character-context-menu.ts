import { Menu, app, type BrowserWindow } from 'electron';
import { resetToDefaultPosition } from './window-position';
import { openApiKeyDialog } from './api-key-dialog';
import type { AppRuntime } from './ipc';

// キャラ右クリックメニュー(設計書 §8.8)。
// 終了文言などキャラ依存の文字列は MVP ではコード内。将来 identity.json へ移行余地あり。

export function showCharacterContextMenu(window: BrowserWindow, runtime: AppRuntime): void {
  const menu = Menu.buildFromTemplate([
    { label: '話す', click: () => window.webContents.send('ene:open-input-area') },
    { type: 'separator' },
    { label: '位置をリセット', click: () => resetToDefaultPosition(window) },
    {
      label: 'APIキーを設定...',
      click: () => {
        // 保存成功時は実行時状態の apiKey を更新し、即座に会話可能にする。
        void openApiKeyDialog(window, (key) => {
          runtime.apiKey = key;
        });
      },
    },
    { type: 'separator' },
    { label: 'じゃあね...', click: () => app.quit() },
  ]);
  menu.popup({ window });
}

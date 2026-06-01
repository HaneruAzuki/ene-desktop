import { Menu, app, type BrowserWindow } from 'electron';
import { resetToDefaultPosition } from './window-position';
import { openApiKeyDialog } from './api-key-dialog';

// キャラ右クリックメニュー(設計書 §8.8)。
// 終了文言などキャラ依存の文字列は MVP ではコード内。将来 identity.json へ移行余地あり。

export function showCharacterContextMenu(window: BrowserWindow): void {
  const menu = Menu.buildFromTemplate([
    { label: '話す', click: () => window.webContents.send('ene:open-input-area') },
    { type: 'separator' },
    { label: '位置をリセット', click: () => resetToDefaultPosition(window) },
    { label: 'APIキーを設定...', click: () => openApiKeyDialog(window) },
    { type: 'separator' },
    { label: 'じゃあね...', click: () => app.quit() },
  ]);
  menu.popup({ window });
}

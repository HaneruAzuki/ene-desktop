import { Tray, Menu, app, nativeImage, dialog, type BrowserWindow } from 'electron';
import { getTrayIconPath } from '../../shared/node/paths';
import { log } from '../../shared/logger';

// タスクトレイ(設計書 §8.8 / 要件 §2.4)。
// フレームレス設計のため、終了手段はトレイとキャラ右クリックの2系統。

let tray: Tray | null = null;

function toggleWindow(window: BrowserWindow): void {
  if (window.isVisible()) {
    window.hide();
  } else {
    window.show();
  }
}

export function createTray(mainWindow: BrowserWindow): Tray {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  if (icon.isEmpty()) {
    log.warn('tray icon is empty or not found');
  }
  tray = new Tray(icon);

  const menu = Menu.buildFromTemplate([
    { label: 'ENE を表示 / 隠す', click: () => toggleWindow(mainWindow) },
    {
      label: 'ENE と話す',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('ene:open-input-area');
      },
    },
    { type: 'separator' },
    {
      label: 'ENE について',
      click: () => {
        void dialog.showMessageBox({
          type: 'info',
          title: 'ENE について',
          message: `ENE Desktop Agent`,
          detail: `version ${app.getVersion()}`,
        });
      },
    },
    { label: 'ENE を終了', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip('ENE - Desktop Character Agent');

  // シングルクリックで表示/非表示トグル
  tray.on('click', () => toggleWindow(mainWindow));

  return tray;
}

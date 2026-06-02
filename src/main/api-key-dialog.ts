import { join } from 'node:path';
import { BrowserWindow, ipcMain, shell } from 'electron';
import { log } from '../shared/logger';
import { encryptAndSaveApiKey } from '../storage/encryption';
import { testApiKey } from './api-key-tester';
import type { PingResult } from '../shared/types/api-key';

// APIキー管理ダイアログ(設計書 §3.7)。
// 専用の BrowserWindow + 専用 preload(window.eneApiKey)で実装する。
// task §6 の IPC 登録は、ダイアログのモジュール状態を共有するため本ファイルに統合した
// (グローバルハンドラは一度だけ登録し、close 結果と onSaved はモジュール変数で受け渡す)。

const ANTHROPIC_CONSOLE_URL = 'https://console.anthropic.com/';

let dialogWindow: BrowserWindow | null = null;
let currentOnSaved: ((key: string) => void) | null = null;
let saveResult = false;
let handlersReady = false;

function ensureHandlers(): void {
  if (handlersReady) return;
  handlersReady = true;

  ipcMain.handle('ene-key:test', async (_event, key: string): Promise<PingResult> => {
    return testApiKey(key);
  });

  ipcMain.handle('ene-key:save', async (_event, key: string): Promise<void> => {
    // 保存前にもう一度疎通テスト(疎通未確認のキーは保存しない・§3.7)。
    const result = await testApiKey(key);
    if (!result.ok) {
      throw new Error('cannot save invalid api key');
    }
    await encryptAndSaveApiKey(key);
    // APIキーはログに出さない(CLAUDE §7.1 / §6.2)。保存成功の事実のみ記録。
    log.info('api key saved');
    currentOnSaved?.(key);
  });

  ipcMain.handle('ene-key:open-console', async (): Promise<void> => {
    await shell.openExternal(ANTHROPIC_CONSOLE_URL);
  });

  ipcMain.handle('ene-key:close', async (_event, ok: boolean): Promise<void> => {
    saveResult = ok;
    dialogWindow?.close();
  });
}

/**
 * APIキー管理ダイアログをモーダルで開く。
 * @param parent 親ウィンドウ(モーダル親)
 * @param onSaved 保存成功時に呼ぶ(実行時状態の apiKey 更新などに使う)
 * @returns 保存して閉じたなら { ok: true }、キャンセル/×で閉じたなら { ok: false }
 */
export async function openApiKeyDialog(
  parent?: BrowserWindow,
  onSaved?: (key: string) => void,
): Promise<{ ok: boolean }> {
  if (dialogWindow) {
    dialogWindow.focus();
    return { ok: false };
  }
  ensureHandlers();
  currentOnSaved = onSaved ?? null;
  saveResult = false;

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 600,
      parent,
      modal: Boolean(parent),
      frame: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'ENE — APIキーの設定',
      webPreferences: {
        preload: join(__dirname, '../preload/api-key-dialog.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    dialogWindow = win;
    win.removeMenu(); // 既定の File/Edit/... メニューバーを出さない
    win.center(); // 画面中央に配置

    win.on('closed', () => {
      const result = saveResult;
      dialogWindow = null;
      currentOnSaved = null;
      resolve({ ok: result });
    });

    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (rendererUrl) {
      void win.loadURL(`${rendererUrl}/api-key-dialog/index.html`);
    } else {
      void win.loadFile(join(__dirname, '../renderer/api-key-dialog/index.html'));
    }
  });
}

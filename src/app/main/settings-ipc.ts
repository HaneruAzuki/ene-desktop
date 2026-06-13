import { ipcMain, dialog, shell, app, type BrowserWindow } from 'electron';
import { loadAppSettings, saveIdleTalk, saveAutoLaunch } from '../../shared/node/app-settings';
import { openApiKeyDialog } from './api-key-dialog';
import { setLogExpanded } from './window-position';
import { getPortableDataDir } from '../../shared/node/paths';
import type { IdleTalkMode } from '../../shared/types/settings';
import type { AppRuntime } from './app-runtime';

// 設定パネル(UI改修 段階6・⚙ボタン)関連の IPC。
// ipc.ts ではなく独立モジュールに置く(並行作業=listening mode と ipc.ts が同居中のため切り分け)。
// 設定の保存先は app-settings.json(平文・§6.1)。lifecycle から registerSettingsIpc で登録する。

export function registerSettingsIpc(mainWindow: BrowserWindow, runtime: AppRuntime): void {
  // 話しかけてくる頻度(自発発話・P7)。idle-talk-manager が loadAppSettings で都度参照する。
  ipcMain.handle('ene:get-idle-talk', async (): Promise<IdleTalkMode> => {
    return (await loadAppSettings()).idleTalk ?? 'low';
  });
  ipcMain.handle('ene:save-idle-talk', async (_event, mode: IdleTalkMode): Promise<void> => {
    await saveIdleTalk(mode);
  });

  // APIキーを変更(ダイアログを開く)。保存成功時は実行時 apiKey を更新し、即座に会話可能にする。
  ipcMain.handle('ene:open-api-key-dialog', async (): Promise<void> => {
    await openApiKeyDialog(mainWindow, (key) => {
      runtime.apiKey = key;
    });
  });

  // 記憶フォルダ(ポータブルデータ data/)を OS のファイラで開く(透明性・データ所有権 §6.4)。
  ipcMain.handle('ene:open-data-folder', async (): Promise<void> => {
    await shell.openPath(getPortableDataDir());
  });

  // API利用状況・残高(残高は API では取得不可=コンソールでのみ確認)。ブラウザで課金ページを開く。
  ipcMain.handle('ene:open-console', async (): Promise<void> => {
    await shell.openExternal('https://console.anthropic.com/settings/billing');
  });

  // 会話ログ(UI改修・VTuber風): 「>>」でウィンドウ幅を伸縮(トリミは左に固定、右にログ領域)。一方向。
  ipcMain.on('ene:set-log-expanded', (_event, expanded: boolean, panelWidth: number) => {
    setLogExpanded(mainWindow, expanded, panelWidth);
  });

  // PC起動時に自動起動。本番は OS のスタートアップが真実、開発は app-settings の値を表示に使う
  // (開発ビルドの electron バイナリをスタートアップに登録しないため・isPackaged で分岐)。
  ipcMain.handle('ene:get-auto-launch', async (): Promise<boolean> => {
    if (app.isPackaged) return app.getLoginItemSettings().openAtLogin;
    return (await loadAppSettings()).autoLaunch ?? false;
  });
  ipcMain.handle('ene:set-auto-launch', async (_event, on: boolean): Promise<void> => {
    await saveAutoLaunch(on);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on });
  });

  // このアプリについて / クレジット(音声合成クレジットは voice.json から・出荷要件)。
  ipcMain.handle('ene:show-about', async (): Promise<void> => {
    const credit = runtime.voiceConfig?.credit ?? 'クレジット情報はまだ読み込まれていません。';
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'このアプリについて',
      message: `魚川トリミ(ENE Desktop Agent) version ${app.getVersion()}`,
      detail: credit,
    });
  });
}

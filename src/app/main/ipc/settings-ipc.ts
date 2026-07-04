import { ipcMain, dialog, shell, app, type BrowserWindow } from 'electron';
import { loadAppSettings, saveIdleTalk, saveAutoLaunch } from '../../../shared/node/app-settings';
import { openApiKeyDialog } from '../api-key/api-key-dialog';
import { getUserDataDir } from '../../../shared/node/paths';
import { exportUserData, importUserData, looksLikeBackup } from '../../../shared/node/user-data-backup';
import { log } from '../../../shared/logger';
import { getSemantic, updateSemantic } from '../../../memory/core/semantic';
import type { IdleTalkMode } from '../../../shared/types/settings';
import type { OwnerName } from '../../../shared/types/ipc';
import type { AppRuntime } from '../bootstrap/app-runtime';
import { IPC } from '../../../shared/ipc-channels';

// 設定パネル(UI改修 段階6・⚙ボタン)関連の IPC。
// ipc.ts ではなく独立モジュールに置く(並行作業=listening mode と ipc.ts が同居中のため切り分け)。
// 設定の保存先は app-settings.json(平文・§6.1)。lifecycle から registerSettingsIpc で登録する。

export function registerSettingsIpc(mainWindow: BrowserWindow, runtime: AppRuntime): void {
  // 自発発話を する/しない(P7)。idle-talk-manager が loadAppSettings で都度参照する。
  // 旧値(low/normal)は on に丸めて返す(2026-06: 頻度段階→する/しないへ簡素化・後方互換)。
  ipcMain.handle(IPC.GET_IDLE_TALK, async (): Promise<IdleTalkMode> => {
    return (await loadAppSettings()).idleTalk === 'off' ? 'off' : 'on';
  });
  ipcMain.handle(IPC.SAVE_IDLE_TALK, async (_event, mode: IdleTalkMode): Promise<void> => {
    await saveIdleTalk(mode);
  });

  // 主人の呼び方(userName)＋その読み(userNameReading)を取得/登録する(設定画面・2026-06)。
  // 本名(userFullName)はここでは扱わない=会話で覚える完全パッシブ(設計合意)。
  ipcMain.handle(IPC.GET_OWNER_NAME, async (): Promise<OwnerName> => {
    const s = await getSemantic();
    return { name: s.userName ?? '', reading: s.userNameReading ?? '' };
  });
  // 設定からの「意図的な」登録/変更。会話/抽出のロック(lockOwnerName)は extraction-trigger 側だけなので、
  // この updateSemantic 直呼び経路は通る=ここでだけ呼び方を確定/改名できる。読みが空なら読みを消す。
  ipcMain.handle(
    IPC.SET_OWNER_NAME,
    async (_event, name: string, reading: string): Promise<void> => {
      await updateSemantic({ userName: name.trim(), userNameReading: reading.trim() || undefined });
    },
  );

  // APIキーを変更(ダイアログを開く)。保存成功時は実行時 apiKey を更新し、即座に会話可能にする。
  ipcMain.handle(IPC.OPEN_API_KEY_DIALOG, async (): Promise<void> => {
    await openApiKeyDialog(mainWindow, (key) => {
      runtime.apiKey = key;
    });
  });

  // 記憶フォルダ(ユーザーデータ=記憶/設定/APIキーの root・userData)を OS のファイラで開く(透明性・§6.4)。
  ipcMain.handle(IPC.OPEN_DATA_FOLDER, async (): Promise<void> => {
    await shell.openPath(getUserDataDir());
  });

  // API利用状況・残高(残高は API では取得不可=コンソールでのみ確認)。ブラウザで課金ページを開く。
  ipcMain.handle(IPC.OPEN_CONSOLE, async (): Promise<void> => {
    await shell.openExternal('https://console.anthropic.com/settings/billing');
  });

  // PC起動時に自動起動。本番は OS のスタートアップが真実、開発は app-settings の値を表示に使う
  // (開発ビルドの electron バイナリをスタートアップに登録しないため・isPackaged で分岐)。
  ipcMain.handle(IPC.GET_AUTO_LAUNCH, async (): Promise<boolean> => {
    if (app.isPackaged) return app.getLoginItemSettings().openAtLogin;
    return (await loadAppSettings()).autoLaunch ?? false;
  });
  ipcMain.handle(IPC.SET_AUTO_LAUNCH, async (_event, on: boolean): Promise<void> => {
    await saveAutoLaunch(on);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on });
  });

  // このアプリについて / クレジット(音声合成クレジットは voice.json から・出荷要件)。
  ipcMain.handle(IPC.SHOW_ABOUT, async (): Promise<void> => {
    const credit = runtime.voiceConfig?.credit ?? 'クレジット情報はまだ読み込まれていません。';
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'このアプリについて',
      message: `魚川トリミ(ENE Desktop Agent) version ${app.getVersion()}`,
      detail: credit,
    });
  });

  // 記憶のエクスポート(書き出し)。設定パネルからの明示起動=OS フォルダ選択は許容(トリミの会話面ではない・N-REL-2)。
  ipcMain.handle(IPC.EXPORT_MEMORY, async (): Promise<{ ok: boolean; message: string }> => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '記憶の書き出し先フォルダを選んでください',
      properties: ['openDirectory', 'createDirectory'],
    });
    const dir = picked.filePaths[0];
    if (picked.canceled || !dir) return { ok: false, message: 'キャンセルしました' };
    try {
      const r = await exportUserData(getUserDataDir(), dir);
      return { ok: true, message: `書き出しました: ${r.path}` };
    } catch (e) {
      log.warn('memory export failed', { name: (e as Error).name });
      return { ok: false, message: '書き出しに失敗しました' };
    }
  });

  // 記憶のインポート(読み込み・復元)。上書き統合のため確認を挟む。反映には再起動が必要。
  ipcMain.handle(IPC.IMPORT_MEMORY, async (): Promise<{ ok: boolean; message: string }> => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '読み込むバックアップ(torimi-memory-backup)フォルダを選んでください',
      properties: ['openDirectory'],
    });
    const src = picked.filePaths[0];
    if (picked.canceled || !src) return { ok: false, message: 'キャンセルしました' };
    if (!looksLikeBackup(src)) {
      return { ok: false, message: 'バックアップが見つかりません(memory / config を含むフォルダを選んでください)' };
    }
    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['読み込む', 'やめる'],
      defaultId: 1,
      cancelId: 1,
      message: '記憶を読み込みますか?',
      detail: '今の記憶・設定に上書き(統合)されます。反映にはアプリの再起動が必要です。',
    });
    if (confirm.response !== 0) return { ok: false, message: 'キャンセルしました' };
    try {
      const r = await importUserData(src, getUserDataDir());
      return { ok: true, message: `読み込みました(${r.dirs.join(', ')})。再起動すると反映されます。` };
    } catch (e) {
      log.warn('memory import failed', { name: (e as Error).name });
      return { ok: false, message: '読み込みに失敗しました' };
    }
  });
}

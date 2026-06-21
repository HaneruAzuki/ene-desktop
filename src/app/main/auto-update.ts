import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log } from '../../shared/logger';

// 自動更新(electron-updater・N-REL-2)。NSIS インストーラ＋GitHub Releases がバックエンド。
//
// フロー: 起動時にチェック → 更新あり → **トリミ口調のダイアログ「今すぐ更新?」** →
//   [今すぐ更新] でダウンロード → 完了したら quitAndInstall(終了処理を経て再起動・更新適用)。
//   [あとで] なら何もしない(次回起動でまた尋ねる)。
//
// 方針(§4.2/§6.2/§7.1 整合):
//   - **読み取り専用 GET のみ**(GitHub の latest.yml/差分)。アプリから送るデータは無い(テレメトリ無し)。
//   - **オフライン/失敗は黙ってスキップ**(起動も会話も一切妨げない・エラーをユーザーに見せない)。
//   - dev(未パッケージ)では何もしない(更新サーバ設定が無く意味がないため)。
//   - 自動DLはしない(autoDownload=false)。必ず同意を取ってから落とす。

let started = false;

/**
 * 自動更新を初期化して起動時チェックを1回走らせる(packaged のみ・背景・非ブロッキング)。
 * 失敗は握りつぶす(best-effort)。起動シーケンスの最後に呼ぶ(ウォームと競合させない)。
 */
export function initAutoUpdate(mainWindow: BrowserWindow): void {
  if (!app.isPackaged || started) return;
  started = true;

  autoUpdater.autoDownload = false; // 同意を取ってから DL する
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null; // electron-updater 自身の冗長ログは出さない(§6.2)

  autoUpdater.on('error', (e) => {
    // オフライン/更新情報なし等。ユーザーには出さず、メタ情報のみ記録(会話内容は含めない・§6.2)。
    log.warn('auto-update: check/download failed', { name: (e as Error).name });
  });

  autoUpdater.on('update-available', () => {
    void promptThenDownload(mainWindow);
  });

  autoUpdater.on('update-downloaded', () => {
    log.info('auto-update: downloaded; quitting to install');
    // 終了処理(記憶抽出・短期クリア)は before-quit 経由で走る。silent インストール＋自動再起動。
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.checkForUpdates().catch((e) => {
    log.warn('auto-update: checkForUpdates threw', { name: (e as Error).name });
  });
}

/** 更新ありダイアログ(トリミ口調)を出し、同意があればダウンロードを開始する。 */
async function promptThenDownload(mainWindow: BrowserWindow): Promise<void> {
  try {
    const target = mainWindow.isDestroyed() ? undefined : mainWindow;
    const opts = {
      type: 'info' as const,
      title: '魚川トリミ',
      message: '新しいわたしになれるみたい。',
      detail: '今すぐ更新する? すぐ終わるよ。終わったら一回だけ再起動するね。',
      buttons: ['今すぐ更新', 'あとで'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const { response } = target
      ? await dialog.showMessageBox(target, opts)
      : await dialog.showMessageBox(opts);
    if (response === 0) {
      log.info('auto-update: user accepted; downloading');
      await autoUpdater.downloadUpdate();
    } else {
      log.info('auto-update: user postponed');
    }
  } catch (e) {
    log.warn('auto-update: prompt/download failed', { name: (e as Error).name });
  }
}

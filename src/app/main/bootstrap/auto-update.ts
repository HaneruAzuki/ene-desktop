import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log } from '../../../shared/logger';
import { UPDATE_CHECK_TIMEOUT_MS } from '../../../shared/constants';

// 自動更新(electron-updater・N-REL-2)。NSIS インストーラ＋GitHub Releases がバックエンド。
//
// タイミング(重要・方針整合): 更新チェックは**準備フェーズ(「ちょっと待って」)の先頭で発火**し、
//   更新ありダイアログは**準備完了前**に出す。準備完了後はシステム的 UI を一切出さない方針のため、
//   native ダイアログは「準備完了前」でのみ使う(準備完了前=システム扱い OK)。
//   起動シーケンスは checkUpdateFlow() の解決を待って ready にする(=ダイアログは必ず準備完了前)。
//
// フロー: 起動時チェック → 更新あり → トリミ口調ダイアログ[今すぐ更新]/[あとで] →
//   [今すぐ更新] DL → quitAndInstall(終了処理=記憶抽出を経て再起動・セッション開始前に新版へ)。
//   [あとで] 何もせず準備続行(次回起動でまた尋ねる)。
//
// 方針(§4.2/§6.2/§7.1):
//   - 読み取り専用 GET のみ(GitHub の latest.yml/差分)。送信データ無し(テレメトリ無し)。
//   - オフライン/失敗/応答遅延は**黙ってスキップ**(タイムアウトで準備を進める=準備完了後にダイアログは出ない)。
//   - dev(未パッケージ)では何もしない。autoDownload=false(必ず同意を取る)。

let started = false;

/**
 * 起動時に1回だけ更新チェックを走らせ、更新フロー(チェック＋ユーザー判断)が片付くまで解決しない Promise を返す。
 * 起動シーケンスはこれを readiness ゲートに含める(ダイアログを準備完了前に限定する)。packaged 以外/2回目は即解決。
 * 解決する条件: 未パッケージ / 最新 / [あとで] / エラー / オフライン / タイムアウト。
 * 解決しない(=アプリ再起動)条件: [今すぐ更新] でダウンロード→インストール。
 */
export function checkUpdateFlow(mainWindow: BrowserWindow): Promise<void> {
  if (!app.isPackaged || started) return Promise.resolve();
  started = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null; // electron-updater 自身の冗長ログは出さない(§6.2)

  return new Promise<void>((resolve) => {
    let settled = false;
    const proceed = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // 応答が遅い/来ない場合の安全網: 一定時間で「今回はスキップ」して準備を進める。
    // これにより準備完了後にダイアログが出ることは絶対にない(遅延時は次回起動で再チェック)。
    // settled 後にタイムアウトが発火しても proceed が no-op なので clear 不要(更新あり時のみ下で clear)。
    const timer = setTimeout(() => {
      log.info('auto-update: check timed out; skipping this launch');
      proceed();
    }, UPDATE_CHECK_TIMEOUT_MS);

    autoUpdater.on('error', (e) => {
      log.warn('auto-update: check/download failed', { name: (e as Error).name });
      proceed();
    });
    autoUpdater.on('update-not-available', () => {
      log.info('auto-update: up to date');
      proceed();
    });
    autoUpdater.on('update-downloaded', () => {
      log.info('auto-update: downloaded; quitting to install');
      // 終了処理(記憶抽出・短期クリア)は before-quit 経由で走る。silent インストール＋自動再起動。
      autoUpdater.quitAndInstall(true, true);
    });
    autoUpdater.on('update-available', () => {
      if (settled) return; // 既に準備を進めた(タイムアウト等)→ 準備完了後に出さない
      clearTimeout(timer); // ダイアログ表示中は readiness を待たせる(「ちょっと待って」を維持)
      void promptThenDownload(mainWindow, proceed);
    });

    autoUpdater.checkForUpdates().catch((e) => {
      log.warn('auto-update: checkForUpdates threw', { name: (e as Error).name });
      proceed();
    });
  });
}

/** 更新ありダイアログ(トリミ口調)を出し、同意があればダウンロードを開始する。[あとで]は準備続行。 */
async function promptThenDownload(mainWindow: BrowserWindow, proceed: () => void): Promise<void> {
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
      // この後 'update-downloaded' → quitAndInstall でアプリ終了→再起動(=proceed は呼ばない=準備は宙吊り)。
    } else {
      log.info('auto-update: user postponed');
      proceed(); // [あとで] → 準備続行
    }
  } catch (e) {
    log.warn('auto-update: prompt/download failed', { name: (e as Error).name });
    proceed(); // 失敗しても準備は続行
  }
}

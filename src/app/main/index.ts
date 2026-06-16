import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import { log } from '../../shared/logger';
import { acquireSingleInstanceLock } from './single-instance';
import { runStartupSequence } from './lifecycle';
import { runShutdownSequence } from './shutdown';
import { stopVoiceEngine } from './voice-engine';
import { getPortableDataDir } from '../../shared/node/paths';
import type { AppRuntime } from './app-runtime';

// Electron main エントリポイント(設計書 §7)。
// 多重起動防止 → 起動シーケンス(lifecycle)→ 終了時に記憶抽出(shutdown)。

// userData(既定は %APPDATA%/<app名>)を安定した ASCII 識別子に固定する(§6.3)。
// app.getName() は packaged 版で productName(=「魚川トリミ」)を使うため、固定しないと
// 既定の userData が日本語パスへ動く。表示名と保存先識別子を分離するための明示設定。
app.setName('ene-desktop');

// ポータブル運用(§3.6/§6.3): Electron の状態(userData=Local Storage/Network/api-key.enc・
// キャッシュ・ログ・クラッシュダンプ)を、exe の隣(dev はプロジェクトルート)の data/ 配下へ向け直す。
// これで %APPDATA% に痕跡を残さず「フォルダ削除＝完全アンインストール」が成立する。
//   - api-key.enc は data/app/ へ移る(getApiKeyPath は userData 基準ゆえ自動追従)。DPAPI 暗号は不変=
//     別PCにフォルダごとコピーしても復号不可で再入力(=ポータブルとして正直な挙動・§6.3)。
//   - getPortableDataDir() は process.execPath/cwd 由来で app.ready 前でも安全に解決できる。
//   - app.ready より前に呼ぶ必要があるため、ここ(モジュール先頭)で設定する。
{
  const dataDir = getPortableDataDir();
  const appStateDir = path.join(dataDir, 'app');
  app.setPath('userData', appStateDir);
  app.setPath('sessionData', appStateDir);
  app.setPath('cache', path.join(appStateDir, 'cache'));
  app.setPath('logs', path.join(dataDir, 'logs'));
  app.setPath('crashDumps', path.join(appStateDir, 'crashes'));
}

const runtime: AppRuntime = {
  charContext: null,
  apiKey: null,
  initialGreeting: null,
  tts: null,
  voiceConfig: null,
  ready: false, // 音声エンジン＋ウォーム完了で true（lifecycle が背景で確定し ene:app-ready を送る）
};
let mainWindow: BrowserWindow | null = null;
let mainWindowCreated = false; // メインウィンドウが一度でも作られたか(起動時 APIキーダイアログの開閉で誤終了しないため)
let shuttingDown = false;

async function start(): Promise<void> {
  try {
    const result = await runStartupSequence(runtime);
    mainWindow = result.mainWindow;
    mainWindowCreated = true;
  } catch (e) {
    // 起動シーケンス内で app.quit() 済み。ここではログのみ。
    log.error('startup failed', { name: (e as Error).name });
    app.quit();
  }
}

if (!acquireSingleInstanceLock()) {
  // 既に別プロセスが起動中 → 静かに終了(設計書 §7.1)
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    // 起動シーケンス中(APIキー入力ダイアログの開閉等)はメインウィンドウ未確立=ここで終了しない。
    // メインウィンドウが一度でも作られた後の「全ウィンドウ閉じ」だけ終了する(ユーザーが本体を閉じた時)。
    // これが無いと初回起動でキー入力→ダイアログが閉じた瞬間に quit し、再起動が必要になっていた。
    if (mainWindowCreated) app.quit();
  });

  // 終了前に記憶抽出 + 短期記憶クリア(設計書 §7.2)。
  // preventDefault して非同期処理を待ってから quit する。
  // apiKey の有無で終了処理全体を止めない: API 依存の記憶抽出(flushExtraction)は
  // runShutdownSequence 内で apiKey を見て出し分けるが、短期記憶クリア(clearShortTerm)は
  // API キーが無くても必ず走らせる(キャンセル経路でも残った短期記憶を残さない)。
  app.on('before-quit', (event) => {
    if (!shuttingDown) {
      event.preventDefault();
      shuttingDown = true;
      void runShutdownSequence(runtime).finally(() => app.quit());
    }
  });

  // 保険: 記憶抽出フロー(apiKey 必須)に入らない経路でも音声サイドカーを止め、孤児プロセスを残さない。
  // stopVoiceEngine は冪等なので、通常終了で既に停止済みでも安全(N-17-12)。
  app.on('will-quit', () => {
    void stopVoiceEngine();
  });

  void start();
}

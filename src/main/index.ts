import { app, type BrowserWindow } from 'electron';
import { log } from '../shared/logger';
import { acquireSingleInstanceLock } from './single-instance';
import { runStartupSequence } from './lifecycle';
import { runShutdownSequence } from './shutdown';
import { stopVoiceEngine } from './voice-engine';
import type { AppRuntime } from './ipc';

// Electron main エントリポイント(設計書 §7)。
// 多重起動防止 → 起動シーケンス(lifecycle)→ 終了時に記憶抽出(shutdown)。

// userData(%APPDATA%/<app名>)を安定した ASCII 識別子に固定する(§6.3)。
// app.getName() は packaged 版で productName(=「魚川トリミ」)を使うため、固定しないと
// userData が日本語パスへ動き、API キー(api-key.enc)の保存先が変わってしまう。
// productName(表示名)と userData(保存先識別子)を分離するための明示設定。
app.setName('ene-desktop');

const runtime: AppRuntime = {
  charContext: null,
  apiKey: null,
  initialGreeting: null,
  tts: null,
  voiceConfig: null,
  voiceInputMode: 'push-to-talk', // 起動時に lifecycle で設定ファイルから上書きする
  ready: false, // 音声エンジン＋ウォーム完了で true（lifecycle が背景で確定し ene:app-ready を送る）
};
let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;

async function start(): Promise<void> {
  try {
    const result = await runStartupSequence(runtime);
    mainWindow = result.mainWindow;
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
    app.quit();
  });

  // 終了前に記憶抽出 + 短期記憶クリア(設計書 §7.2)。
  // preventDefault して非同期処理を待ってから quit する。
  app.on('before-quit', (event) => {
    if (!shuttingDown && runtime.apiKey) {
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

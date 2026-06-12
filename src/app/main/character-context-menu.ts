import { Menu, app, dialog, type BrowserWindow } from 'electron';
import { resetToDefaultPosition } from './window-position';
import { openApiKeyDialog } from './api-key-dialog';
import { saveVoiceInputMode } from '../../shared/node/app-settings';
import type { AppRuntime } from './app-runtime';
import type { VoiceInputMode } from '../../shared/types/settings';

// キャラ右クリックメニュー(設計書 §8.8)。
// 終了文言などキャラ依存の文字列は MVP ではコード内。将来 identity.json へ移行余地あり。

export function showCharacterContextMenu(window: BrowserWindow, runtime: AppRuntime): void {
  // マイク入力方式を切替える(設定保存＋Renderer へ通知・task_17 Phase C)。
  const setVoiceMode = (mode: VoiceInputMode): void => {
    runtime.voiceInputMode = mode;
    void saveVoiceInputMode(mode);
    if (!window.isDestroyed()) window.webContents.send('ene:voice-input-mode-changed', mode);
  };

  const menu = Menu.buildFromTemplate([
    { label: '話す', click: () => window.webContents.send('ene:open-input-area') },
    { type: 'separator' },
    {
      label: 'マイク入力方式',
      submenu: [
        {
          label: 'Push-to-Talk(押している間だけ録音)',
          type: 'radio',
          checked: runtime.voiceInputMode === 'push-to-talk',
          click: () => setVoiceMode('push-to-talk'),
        },
        {
          label: 'ハンズフリー(音声検出で自動)',
          type: 'radio',
          checked: runtime.voiceInputMode === 'hands-free',
          click: () => setVoiceMode('hands-free'),
        },
      ],
    },
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
    {
      label: 'クレジット / ライセンス',
      click: () => {
        // つくよみコーパスの必須クレジットを表示(voice.json から・出荷要件)。
        const credit = runtime.voiceConfig?.credit ?? 'クレジット情報はまだ読み込まれていません。';
        void dialog.showMessageBox(window, {
          type: 'info',
          title: 'クレジット',
          message: '音声合成クレジット',
          detail: credit,
        });
      },
    },
    { type: 'separator' },
    { label: 'じゃあね...', click: () => app.quit() },
  ]);
  menu.popup({ window });
}

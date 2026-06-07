// アプリ設定(ユーザー設定・task_17 Phase C)。
// data/config/app-settings.json に平文JSONで保存する(§6.1)。

/** マイクボタンの入力方式。push-to-talk(押している間録音) or hands-free(音声検出で自動)。 */
export type VoiceInputMode = 'push-to-talk' | 'hands-free';

export interface AppSettings {
  voiceInputMode: VoiceInputMode;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  voiceInputMode: 'push-to-talk',
};

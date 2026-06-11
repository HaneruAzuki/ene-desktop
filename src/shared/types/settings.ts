// アプリ設定(ユーザー設定・task_17 Phase C)。
// data/config/app-settings.json に平文JSONで保存する(§6.1)。

import type { VrmDisplayParams } from './vrm';

/** マイクボタンの入力方式。push-to-talk(押している間録音) or hands-free(音声検出で自動)。 */
export type VoiceInputMode = 'push-to-talk' | 'hands-free';

export interface AppSettings {
  voiceInputMode: VoiceInputMode;
  /**
   * VRM 表示パラメータのユーザー上書き(F・3D化)。GUI スライダーで調整→保存する。
   * 未設定なら vrm.json の display 既定値を使う(部分上書きも可)。
   */
  vrmDisplay?: Partial<VrmDisplayParams>;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  voiceInputMode: 'push-to-talk',
};

// アプリ設定(ユーザー設定・task_17 Phase C)。
// data/config/app-settings.json に平文JSONで保存する(§6.1)。

import type { VrmDisplayParams } from './vrm';

/** マイクボタンの入力方式。push-to-talk(押している間録音) or hands-free(音声検出で自動)。 */
export type VoiceInputMode = 'push-to-talk' | 'hands-free';

/** 自発発話(アイドル時)の頻度設定。off=しない / low=控えめ(既定) / normal=やや多め(P7)。 */
export type IdleTalkMode = 'off' | 'low' | 'normal';

export interface AppSettings {
  voiceInputMode: VoiceInputMode;
  /**
   * VRM 表示パラメータのユーザー上書き(F・3D化)。GUI スライダーで調整→保存する。
   * 未設定なら vrm.json の display 既定値を使う(部分上書きも可)。
   */
  vrmDisplay?: Partial<VrmDisplayParams>;
  /** 自発発話(アイドル時)の頻度(P7・既定 low)。off で完全に黙る。 */
  idleTalk?: IdleTalkMode;
  /** トリミの声(出力)の音量 0〜1(UI改修 段階3・既定 1)。 */
  outputVolume?: number;
  /** ミュート状態(UI改修 段階3・既定 false)。 */
  muted?: boolean;
  /** PC起動時に自動起動(UI改修 段階6・既定 false)。本番は OS のスタートアップ、開発はこの値を表示に使う。 */
  autoLaunch?: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  voiceInputMode: 'push-to-talk',
  idleTalk: 'low',
  outputVolume: 1,
  muted: false,
  autoLaunch: false,
};

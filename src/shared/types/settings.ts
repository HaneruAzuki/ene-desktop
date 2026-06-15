// アプリ設定(ユーザー設定・task_17 Phase C)。
// data/config/app-settings.json に平文JSONで保存する(§6.1)。

import type { VrmDisplayParams } from './vrm';

/** 自発発話(アイドル時)の設定。する/しない の2択(2026-06: 頻度の段階は廃止。離席中は別途自動でしない)。 */
export type IdleTalkMode = 'off' | 'on';

export interface AppSettings {
  /**
   * VRM 表示パラメータのユーザー上書き(F・3D化)。GUI スライダーで調整→保存する。
   * 未設定なら vrm.json の display 既定値を使う(部分上書きも可)。
   */
  vrmDisplay?: Partial<VrmDisplayParams>;
  /** 自発発話(アイドル時)を する/しない(P7・既定 on)。off で黙る。旧 low/normal は on 相当に丸める。 */
  idleTalk?: IdleTalkMode;
  /** トリミの声(出力)の音量 0〜1(UI改修 段階3・既定 1)。 */
  outputVolume?: number;
  /** ミュート状態(UI改修 段階3・既定 false)。 */
  muted?: boolean;
  /** PC起動時に自動起動(UI改修 段階6・既定 false)。本番は OS のスタートアップ、開発はこの値を表示に使う。 */
  autoLaunch?: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  idleTalk: 'on',
  outputVolume: 1,
  muted: false,
  autoLaunch: false,
};

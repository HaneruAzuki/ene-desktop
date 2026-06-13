import React, { forwardRef, useState } from 'react';
import type { VrmDisplayParams } from '../../../shared/types/vrm';
import type { IdleTalkMode } from '../../../shared/types/settings';

// 統合設定パネル(UI改修 段階6・⚙)。
// - 話しかけてくる頻度(自発発話・P7)
// - 見た目の調整(VRM): 行にホバーで詳細スライダーを出す(数値は出さない)
// - APIキーを変更 / このアプリについて(クレジット)
// 位置リセットはドラッグで足りるため廃止、キャラ右クリックメニューも廃止(2026-06 ユーザー方針)。

interface Props {
  idleTalk: IdleTalkMode;
  onIdleTalkChange: (mode: IdleTalkMode) => void;
  autoLaunch: boolean;
  onAutoLaunchChange: (on: boolean) => void;
  /** VRM モード時のみ。PNG フォールバック時は見た目調整を出さない。 */
  vrmDisplay?: VrmDisplayParams;
  onVrmChange?: (display: VrmDisplayParams) => void;
  onApiKey: () => void;
  onAbout: () => void;
  onOpenDataFolder: () => void;
  onConsole: () => void;
  onClose: () => void;
}

const IDLE_OPTIONS: { value: IdleTalkMode; label: string }[] = [
  { value: 'off', label: 'しない' },
  { value: 'low', label: '控えめ' },
  { value: 'normal', label: 'ふつう' },
];

// 調整範囲(2026-06 ユーザー指定)。腕下げは -70 固定でスライダーを出さない。数値は表示しない。
const SLIDERS: { key: keyof VrmDisplayParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'height', label: '高さ', min: 0.05, max: 0.17, step: 0.005 },
  { key: 'distance', label: '距離', min: 0.25, max: 2.0, step: 0.01 },
  { key: 'yawDeg', label: '向き', min: -45, max: 45, step: 1 },
];

export const SettingsPanel = forwardRef<HTMLDivElement, Props>(function SettingsPanel(
  {
    idleTalk,
    onIdleTalkChange,
    autoLaunch,
    onAutoLaunchChange,
    vrmDisplay,
    onVrmChange,
    onApiKey,
    onAbout,
    onOpenDataFolder,
    onConsole,
    onClose,
  },
  ref,
) {
  const [showVrm, setShowVrm] = useState(false);
  return (
    <div className="settings-panel" ref={ref}>
      <div className="settings-panel__head">
        <span>設定</span>
        <button className="settings-panel__close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      <div className="settings-panel__section">
        <div className="settings-panel__label">話しかけてくる頻度</div>
        <div className="settings-seg">
          {IDLE_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`settings-seg__btn${idleTalk === o.value ? ' settings-seg__btn--on' : ''}`}
              onClick={() => onIdleTalkChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-panel__section settings-toggle-row">
        <span className="settings-panel__label">PC起動時に自動起動</span>
        <button
          className={`settings-toggle${autoLaunch ? ' settings-toggle--on' : ''}`}
          onClick={() => onAutoLaunchChange(!autoLaunch)}
          role="switch"
          aria-checked={autoLaunch}
        >
          {autoLaunch ? 'オン' : 'オフ'}
        </button>
      </div>

      {vrmDisplay && onVrmChange && (
        <div
          className="settings-vrm"
          onMouseEnter={() => setShowVrm(true)}
          onMouseLeave={() => setShowVrm(false)}
        >
          <button className="settings-action">見た目の調整 ▸</button>
          {showVrm && (
            <div className="settings-vrm__popup">
              {SLIDERS.map((s) => (
                <label className="settings-row" key={s.key}>
                  <span className="settings-row__label">{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={vrmDisplay[s.key]}
                    onChange={(e) => onVrmChange({ ...vrmDisplay, [s.key]: parseFloat(e.target.value) })}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="settings-panel__section settings-panel__actions">
        <button className="settings-action" onClick={onOpenDataFolder}>
          記憶フォルダを開く
        </button>
        <button className="settings-action" onClick={onApiKey}>
          APIキーを変更
        </button>
        <button className="settings-action" onClick={onConsole}>
          API利用状況・残高(コンソール)
        </button>
        <button className="settings-action" onClick={onAbout}>
          このアプリについて / クレジット
        </button>
      </div>
    </div>
  );
});

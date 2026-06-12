import React, { forwardRef } from 'react';
import type { VrmDisplayParams } from '../../../shared/types/vrm';

// VRM 表示パラメータの調整パネル(F・GUI スライダー)。
// 値の保存(data/config)は呼び出し側(App)が onChange でデバウンスして行う。
// 透過浮遊の見た目を邪魔しないよう、開いている間だけ小さく表示する。

interface Props {
  display: VrmDisplayParams;
  onChange: (display: VrmDisplayParams) => void;
  onClose: () => void;
}

interface SliderDef {
  key: keyof VrmDisplayParams;
  label: string;
  min: number;
  max: number;
  step: number;
}

// 範囲はハーネス(scripts/vrm-harness.html)と同一。
const SLIDERS: SliderDef[] = [
  { key: 'height', label: '高さ', min: -0.4, max: 0.4, step: 0.01 },
  { key: 'distance', label: '距離', min: 0.25, max: 1.5, step: 0.01 },
  { key: 'yawDeg', label: '向きY', min: -60, max: 60, step: 1 },
  { key: 'armDownDeg', label: '腕下げ', min: -85, max: 85, step: 1 },
];

export const VrmSettingsPanel = forwardRef<HTMLDivElement, Props>(
  function VrmSettingsPanel({ display, onChange, onClose }, ref) {
    function update(key: keyof VrmDisplayParams, value: number): void {
      onChange({ ...display, [key]: value });
    }
    return (
      <div className="vrm-panel" ref={ref}>
        <div className="vrm-panel__head">
          <span>表示調整</span>
          <button className="vrm-panel__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        {SLIDERS.map((s) => (
          <label className="vrm-panel__row" key={s.key}>
            <span className="vrm-panel__label">{s.label}</span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={display[s.key]}
              onChange={(e) => update(s.key, parseFloat(e.target.value))}
            />
            <span className="vrm-panel__value">{display[s.key]}</span>
          </label>
        ))}
      </div>
    );
  },
);

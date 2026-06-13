import React, { useState } from 'react';

// 音量コントロール(UI改修 2026-06 段階3・docs/ui-design.md §3)。
// ボタン: クリックでミュート切替(🔊⇄🔇)。ホバーで音量ノブ(スライダー)を上にポップ表示。
// ポップはキャラの不透明部の上に出るため、クリックスルー判定上も操作可能(overChar で interactive)。
// 対象は「トリミの声=出力」。スライダーは保持音量を表示し、動かすとミュートは自動解除する。

interface Props {
  /** 0〜1。 */
  volume: number;
  muted: boolean;
  onToggleMute: () => void;
  /** 0〜1。 */
  onVolume: (v: number) => void;
}

export function VolumeControl({ volume, muted, onToggleMute, onVolume }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="vol" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open && (
        <div className="vol-popup">
          <input
            type="range"
            className="vol-slider"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolume(Number(e.target.value) / 100)}
            aria-label="音量"
          />
        </div>
      )}
      <button
        className="ctl-btn"
        title={muted ? 'ミュート中(クリックで解除)' : '音量(クリックでミュート)'}
        aria-label={muted ? 'ミュートを解除' : 'ミュート'}
        onClick={onToggleMute}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}

import React from 'react';
import { VolumeControl } from './VolumeControl';

// 操作バー(UI改修 2026-06・docs/ui-design.md §1)。
// キャラ下部にホバーで現れる5ボタン:マイク / 音量 / 離席 / 設定 / じゃあね(左→右)。
// マイクのみ主操作=大きめ。じゃあねは少し離す(誤クリック防止)。
// 配線状況: 全ボタン配線済み(マイク=単一ハイブリッド / 音量 / 離席=後ろを向く / 設定=統合パネル / じゃあね=最小化)。

interface MicHandlers {
  onClick?: () => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onMouseLeave?: () => void;
}

interface Props {
  /** マイクがON(リッスン中=ハンズフリー起動中 or PTT 押下中)か。点灯表示に使う。 */
  micActive: boolean;
  /** マイクの操作(単一ハイブリッド: タップ=トグル / 長押し=PTT)。App 側で組み立てる。 */
  micHandlers: MicHandlers;
  micTitle: string;
  /** 音量(トリミの声=出力)0〜1。 */
  volume: number;
  muted: boolean;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
  away: boolean;
  onAway?: () => void;
  onSettings?: () => void;
  onGoodbye?: () => void;
}

export function ControlBar({
  micActive,
  micHandlers,
  micTitle,
  volume,
  muted,
  onToggleMute,
  onVolume,
  away,
  onAway,
  onSettings,
  onGoodbye,
}: Props): React.ReactElement {
  return (
    <div className="control-row">
      <button
        className={`ctl-btn ctl-mic${micActive ? ' ctl-mic--on' : ''}`}
        title={micTitle}
        aria-label="音声入力"
        {...micHandlers}
      >
        🎙️
      </button>
      <VolumeControl volume={volume} muted={muted} onToggleMute={onToggleMute} onVolume={onVolume} />
      <button
        className={`ctl-btn${away ? ' ctl-away--on' : ''}`}
        title={away ? '離席中(クリックで戻る)' : '離席(ちょっとまってね)'}
        aria-label="離席"
        onClick={onAway}
      >
        ☕
      </button>
      <button className="ctl-btn" title="設定" aria-label="設定" onClick={onSettings}>
        ⚙
      </button>
      <button className="ctl-btn ctl-bye" title="じゃあね" aria-label="閉じる" onClick={onGoodbye}>
        👋
      </button>
    </div>
  );
}

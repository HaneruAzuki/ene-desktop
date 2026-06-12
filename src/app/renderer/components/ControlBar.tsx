import React from 'react';

// 操作バー(UI改修 2026-06・docs/ui-design.md §1)。
// キャラ下部にホバーで現れる5ボタン:マイク / 音量 / 離席 / 設定 / じゃあね(左→右)。
// マイクのみ主操作=大きめ。じゃあねは少し離す(誤クリック防止)。
// 段階1(土台)では「マイク」と「設定(=当面 VRM 調整パネルの開閉)」のみ配線し、
// 音量/離席/じゃあねは置き場のみ(各 onXxx 未指定=不活性。段階3/5/4 で実装)。

interface MicHandlers {
  onClick?: () => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onMouseLeave?: () => void;
}

interface Props {
  /** マイクがON(リッスン中=ハンズフリー起動中 or PTT 押下中)か。点灯表示に使う。 */
  micActive: boolean;
  /** マイク方式に応じた操作(クリック=トグル or 押下中=PTT)。App 側で組み立てる。 */
  micHandlers: MicHandlers;
  micTitle: string;
  onVolume?: () => void;
  onAway?: () => void;
  onSettings?: () => void;
  onGoodbye?: () => void;
}

export function ControlBar({
  micActive,
  micHandlers,
  micTitle,
  onVolume,
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
      <button className="ctl-btn" title="音量・ミュート" aria-label="音量" onClick={onVolume}>
        🔊
      </button>
      <button className="ctl-btn" title="離席(ちょっとまってね)" aria-label="離席" onClick={onAway}>
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

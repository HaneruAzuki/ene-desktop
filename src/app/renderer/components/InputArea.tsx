import React, { forwardRef, useEffect, useRef, useState } from 'react';

// 入力欄(設計書 §8.4 / UI改修 2026-06)。Enter で送信、ESC で閉じる。
// UI改修で「キャラ下部の操作オーバーレイに常設するピル」へ変更(従来の「キャラをクリックで展開」は廃止)。
// マイク入力は ControlBar 側に集約。
// - autoFocus: トレイ等から明示展開した時のみフォーカスする(ホバーで出ただけでは奪わない)。
// - onActivate: 入力が始まった合図(初回フォーカス)。App 側で未ウォームならキャッシュを温める。
// - onFocusChange: 入力中はマウスが離れてもオーバーレイを保持するため、フォーカス状態を親へ伝える。

interface Props {
  onSubmit: (text: string) => void;
  onClose: () => void;
  autoFocus?: boolean;
  onActivate?: () => void;
  onFocusChange?: (focused: boolean) => void;
}

export const InputArea = forwardRef<HTMLDivElement, Props>(function InputArea(
  { onSubmit, onClose, autoFocus = false, onActivate, onFocusChange },
  ref,
) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setText('');
        inputRef.current?.blur(); // 送信したら一旦フォーカスを外す(ホバー外なら自然にオーバーレイが消える)
      }
    } else if (e.key === 'Escape') {
      inputRef.current?.blur();
      onClose();
    }
  }

  return (
    <div ref={ref} className="input-area">
      <input
        ref={inputRef}
        className="input-field"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          onActivate?.();
          onFocusChange?.(true);
        }}
        onBlur={() => onFocusChange?.(false)}
        placeholder="話しかける…"
      />
    </div>
  );
});

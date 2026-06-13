import React, { forwardRef, useEffect, useRef, useState } from 'react';

// 入力欄(設計書 §8.4 / UI改修 2026-06)。Enter で送信、Shift+Enter で改行、ESC で閉じる。
// UI改修で「キャラ下部の操作オーバーレイに常設するピル」へ変更(従来の「キャラをクリックで展開」は廃止)。
// 長文は内容に応じて下へ伸びる(最大3行=CSS の max-height、それ以上は内部スクロール)。
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // アンマウント時に「フォーカス解除」を必ず親へ伝える(onBlur 未発火のまま消えると
  // inputFocused が true で固着しバーが畳まれないため・UI改修 段階5 修正)。
  useEffect(() => () => onFocusChange?.(false), [onFocusChange]);

  /** 内容に合わせて高さを伸ばす(上限は CSS の max-height=3行・超過分は内部スクロール)。 */
  function autoGrow(): void {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setText('');
        if (inputRef.current) inputRef.current.style.height = 'auto'; // 高さを1行に戻す
        inputRef.current?.blur(); // 送信したらフォーカスを外す(ホバー外なら自然にオーバーレイが消える)
      }
    } else if (e.key === 'Escape') {
      inputRef.current?.blur();
      onClose();
    }
  }

  return (
    <div ref={ref} className="input-area">
      <textarea
        ref={inputRef}
        className="input-field"
        rows={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          autoGrow();
        }}
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

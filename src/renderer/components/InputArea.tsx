import React, { forwardRef, useEffect, useRef, useState } from 'react';

// 入力欄(設計書 §8.4)。Enter で送信、ESC で閉じる。
// マイク入力は App 側の統合マイクボタン(入力欄の下・中央)に集約した(task_17 Phase C)。

interface Props {
  onSubmit: (text: string) => void;
  onClose: () => void;
}

export const InputArea = forwardRef<HTMLDivElement, Props>(function InputArea(
  { onSubmit, onClose },
  ref,
) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setText('');
      }
    } else if (e.key === 'Escape') {
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
        placeholder="トリミに話しかける..."
      />
    </div>
  );
});

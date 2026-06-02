import React, { forwardRef, useEffect, useRef } from 'react';
import { BUBBLE_AUTO_DISMISS_MS, BUBBLE_MAX_WIDTH_PX, BUBBLE_MAX_HEIGHT_PX } from '../constants';

// 応答吹き出し(設計書 §8.5)。

interface Props {
  message: string;
  onClose: () => void;
}

export const SpeechBubble = forwardRef<HTMLDivElement, Props>(function SpeechBubble(
  { message, onClose },
  ref,
) {
  // 30秒で自動消滅。依存は message のみ(onClose は毎レンダー変わるため ref 経由で参照)。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const timer = setTimeout(() => onCloseRef.current(), BUBBLE_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div
      ref={ref}
      className="bubble"
      onClick={onClose}
      style={{
        maxWidth: `${BUBBLE_MAX_WIDTH_PX}px`,
        // ウィンドウ高(240×320)に収まるよう制約しつつ、最大は §8.5 の 400px。
        maxHeight: `min(${BUBBLE_MAX_HEIGHT_PX}px, calc(100vh - 90px))`,
        overflowY: 'auto',
      }}
    >
      {message}
    </div>
  );
});

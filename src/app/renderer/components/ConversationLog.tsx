import React, { forwardRef, useEffect, useRef } from 'react';

// 会話ログ(UI改修・VTuber風)。ウィンドウを右に広げて、トリミの横に最新のやりとりを並べる。
// セッション内のメモリのみ(逐語ログは保存しない=CLAUDE §6.3 と整合)。新着で自動的に最下部へスクロール。

export interface LogEntry {
  role: 'user' | 'torimi';
  text: string;
}

interface Props {
  entries: LogEntry[];
}

export const ConversationLog = forwardRef<HTMLDivElement, Props>(function ConversationLog(
  { entries },
  ref,
) {
  const listRef = useRef<HTMLDivElement>(null);

  // 新着で最下部へ(最新の発話が常に見える)。
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="log-panel" ref={ref}>
      <div className="log-panel__head">会話ログ</div>
      <div className="log-panel__list" ref={listRef}>
        {entries.length === 0 ? (
          <div className="log-empty">まだ会話はありません。</div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={`log-msg log-msg--${e.role}`}>
              <span className="log-msg__who">{e.role === 'user' ? 'あなた' : 'トリミ'}</span>
              <span className="log-msg__text">{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

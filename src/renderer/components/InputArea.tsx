import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { startRecording, type Recorder } from '../mic-capture';
import { STT_SAMPLE_RATE } from '../../shared/constants';

// 入力欄(設計書 §8.4)。Enter で送信、ESC で閉じる。
// マイクボタンは push-to-talk(押している間だけ録音・離すと認識→送信・task_17 Phase B)。

interface Props {
  onSubmit: (text: string) => void;
  onClose: () => void;
  /** 音声入力の失敗等をキャラ口調で知らせる(吹き出し表示は親が行う)。 */
  onNotice?: (message: string) => void;
}

/** これ未満の長さ(秒)の録音は誤タップ扱いで無視する。 */
const MIN_RECORDING_SEC = 0.3;

type RecState = 'idle' | 'recording' | 'transcribing';

export const InputArea = forwardRef<HTMLDivElement, Props>(function InputArea(
  { onSubmit, onClose, onNotice },
  ref,
) {
  const [text, setText] = useState('');
  const [recState, setRecState] = useState<RecState>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<Recorder | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // アンマウント時に録音が残っていれば破棄(リーク防止)。
  useEffect(() => {
    return () => recorderRef.current?.cancel();
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

  async function startRec(): Promise<void> {
    if (recState !== 'idle') return;
    try {
      recorderRef.current = await startRecording();
      setRecState('recording');
    } catch {
      recorderRef.current = null;
      onNotice?.('…マイクが使えないみたい。マイクの接続や設定を確認してみて?');
    }
  }

  async function stopRec(): Promise<void> {
    const rec = recorderRef.current;
    if (!rec || recState !== 'recording') return;
    recorderRef.current = null;
    setRecState('transcribing');
    try {
      const samples = await rec.stop();
      // 短すぎる録音(誤タップ)は黙って無視する。
      if (samples.length < STT_SAMPLE_RATE * MIN_RECORDING_SEC) {
        setRecState('idle');
        return;
      }
      const result = await window.ene.transcribeAudio(samples);
      setRecState('idle');
      if (result.ok) {
        onSubmit(result.text);
      } else {
        onNotice?.(result.message);
      }
    } catch {
      setRecState('idle');
      onNotice?.('…うまく聞き取れなかった。もう一回試してみて?');
    }
  }

  const micLabel = recState === 'idle' ? '🎤' : recState === 'recording' ? '●' : '…';

  return (
    <div ref={ref} className="input-area">
      <div className="input-row">
        <input
          ref={inputRef}
          className="input-field"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ENEに話しかける..."
        />
        <button
          type="button"
          className={`mic-button${recState !== 'idle' ? ' mic-button--active' : ''}`}
          // push-to-talk: 押下で録音開始、離す/外れると停止→認識。
          onMouseDown={() => void startRec()}
          onMouseUp={() => void stopRec()}
          onMouseLeave={() => void stopRec()}
          disabled={recState === 'transcribing'}
          title="押している間だけ録音(離すと認識します)"
          aria-label="音声入力"
        >
          {micLabel}
        </button>
      </div>
    </div>
  );
});

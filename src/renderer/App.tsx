import React, { useEffect, useRef, useState } from 'react';
import { CharacterDisplay, type CharacterDisplayHandle } from './components/CharacterDisplay';
import { SpeechBubble } from './components/SpeechBubble';
import { InputArea } from './components/InputArea';
import { playClick } from './sound';
import { SOFA_AFTER_IDLE_MS, MOUTH_FLAP_MS, TALKING_MIN_MS, TALKING_MAX_MS } from './constants';
import type { CharacterInfo } from '../shared/types/ipc';
import type { CharacterState } from '../shared/types/animation';

// トップコンポーネント(設計書 §8 / task_13)。
// キャラ表示・吹き出し・入力欄を束ね、透明領域のクリックスルーを制御する。
// アニメ状態機械(activity/emotion/pose)を保持し、送信→考える間→口パク→idle を駆動する。

function rectContains(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

export function App(): React.ReactElement | null {
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const [inputVisible, setInputVisible] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [charState, setCharState] = useState<CharacterState>({
    activity: 'idle',
    emotion: 'neutral',
    pose: 'stand',
  });

  const charRef = useRef<CharacterDisplayHandle>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const lastIgnoreRef = useRef<boolean | null>(null);
  const talkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 起動時に CharacterInfo を取得
  useEffect(() => {
    void window.ene.getCharacterInfo().then(setCharacterInfo);
  }, []);

  // 起動挨拶を1回取得して吹き出しに表示(設計書 §8.7)
  useEffect(() => {
    void window.ene.getInitialGreeting().then((greeting) => {
      if (greeting) setBubble(greeting);
    });
  }, []);

  // トレイ / コンテキストメニューからのイベント
  useEffect(() => {
    window.ene.onOpenInputArea(() => openInput());
    window.ene.onResetPosition(() => {
      /* 位置リセットは main 側で実施。Renderer は特に何もしない。 */
    });
  }, []);

  // 入力欄を開いた瞬間に Tier0 キャッシュを温める(task_14 Phase 3・初回応答の体感を速く)。
  useEffect(() => {
    if (inputVisible) void window.ene.warmCache();
  }, [inputVisible]);

  // ESC で入力欄・吹き出しを閉じる(吹き出しが閉じたら idle へ)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setInputVisible(false);
        dismissBubble();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 長時間 idle で寝そべり(F-ANIM-03)。activity/pose が変わるたびタイマー再設定。
  useEffect(() => {
    if (charState.activity !== 'idle' || charState.pose !== 'stand') return;
    const id = setTimeout(() => setCharState((s) => ({ ...s, pose: 'sofa' })), SOFA_AFTER_IDLE_MS);
    return () => clearTimeout(id);
  }, [charState.activity, charState.pose]);

  // クリックスルー(§8.6): キャラ不透明 OR 吹き出し OR 入力欄 のいずれかの上なら不透過。
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const interactive =
        (charRef.current?.isOpaqueAt(e.clientX, e.clientY) ?? true) ||
        rectContains(bubbleRef.current, e.clientX, e.clientY) ||
        rectContains(inputRef.current, e.clientX, e.clientY);
      const ignore = !interactive;
      if (lastIgnoreRef.current !== ignore) {
        lastIgnoreRef.current = ignore;
        void window.ene.setIgnoreMouseEvents(ignore);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  /** 吹き出しを閉じ、talking 中なら idle に戻す。 */
  function dismissBubble(): void {
    setBubble(null);
    setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle' } : s));
  }

  /** 入力欄を開く(操作=起き上がる・クリック音)。 */
  function openInput(): void {
    playClick();
    setInputVisible(true);
    setCharState((s) => ({ ...s, pose: 'stand' }));
  }

  async function handleSubmit(text: string): Promise<void> {
    playClick();
    setBubble(null); // 古い吹き出しを即消去
    setInputVisible(false);
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' })); // 考える間
    const response = await window.ene.sendMessage(text);
    const emotion = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
    setCharState((s) => ({ ...s, activity: 'talking', emotion, pose: 'stand' }));
    setBubble(response.message);

    // 口パクはメッセージ長に比例した時間だけ(「一文字1口パク」)。話し終えたら idle へ戻し口を閉じる。
    // 吹き出し(テキスト)はそのまま表示を続ける。表情は idle でも保持する。
    const talkMs = Math.min(
      TALKING_MAX_MS,
      Math.max(TALKING_MIN_MS, response.message.length * MOUTH_FLAP_MS),
    );
    talkingTimerRef.current = setTimeout(() => {
      setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle' } : s));
    }, talkMs);
  }

  if (!characterInfo) return null;

  return (
    <div className="app">
      {/* 考える間(thinking)の演出。専用スプライトが無いので「…」で示す(F-ANIM-04)。 */}
      {charState.activity === 'thinking' && <div className="bubble bubble--thinking">…</div>}
      {bubble !== null && (
        <SpeechBubble ref={bubbleRef} message={bubble} onClose={dismissBubble} />
      )}
      <CharacterDisplay
        ref={charRef}
        portraitUrl={characterInfo.portraitUrl}
        animation={characterInfo.animation}
        state={charState}
        onClick={openInput}
      />
      {inputVisible && (
        <InputArea ref={inputRef} onSubmit={handleSubmit} onClose={() => setInputVisible(false)} />
      )}
    </div>
  );
}

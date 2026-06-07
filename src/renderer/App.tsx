import React, { useEffect, useRef, useState } from 'react';
import { CharacterDisplay, type CharacterDisplayHandle } from './components/CharacterDisplay';
import { SpeechBubble } from './components/SpeechBubble';
import { InputArea } from './components/InputArea';
import type { CharacterInfo } from '../shared/types/ipc';

// トップコンポーネント(設計書 §8)。
// キャラ表示・吹き出し・入力欄を束ね、透明領域のクリックスルーを制御する。

function rectContains(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

export function App(): React.ReactElement | null {
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const [inputVisible, setInputVisible] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);

  const charRef = useRef<CharacterDisplayHandle>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const lastIgnoreRef = useRef<boolean | null>(null);

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
    window.ene.onOpenInputArea(() => setInputVisible(true));
    window.ene.onResetPosition(() => {
      /* 位置リセットは main 側で実施。Renderer は特に何もしない。 */
    });
  }, []);

  // 入力欄を開いた瞬間に Tier0 キャッシュを温める(task_14 Phase 3・初回応答の体感を速く)。
  useEffect(() => {
    if (inputVisible) void window.ene.warmCache();
  }, [inputVisible]);

  // ESC で入力欄・吹き出しを閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setInputVisible(false);
        setBubble(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

  async function handleSubmit(text: string): Promise<void> {
    setBubble(null); // 古い吹き出しを即消去
    setInputVisible(false);
    const response = await window.ene.sendMessage(text);
    setBubble(response.message);
  }

  if (!characterInfo) return null;

  return (
    <div className="app">
      {bubble !== null && (
        <SpeechBubble ref={bubbleRef} message={bubble} onClose={() => setBubble(null)} />
      )}
      <CharacterDisplay
        ref={charRef}
        portraitUrl={characterInfo.portraitUrl}
        onClick={() => setInputVisible(true)}
      />
      {inputVisible && (
        <InputArea ref={inputRef} onSubmit={handleSubmit} onClose={() => setInputVisible(false)} />
      )}
    </div>
  );
}

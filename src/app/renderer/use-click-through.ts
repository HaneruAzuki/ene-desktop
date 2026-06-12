import { useEffect, useRef, type RefObject } from 'react';
import type { CharacterDisplayHandle } from './components/CharacterDisplay';

// クリックスルー判定(§8.6): キャラ不透明 OR 吹き出し/入力欄/マイク/歯車/パネル の上なら不透過、
// それ以外は透過(下のウィンドウへマウスを通す)。判定には VRM のレイキャスト(やや重い)が含まれるため、
// mousemove ごとでなく rAF で1フレーム1回に間引く(ドラッグ中の連続 mousemove で詰まるのを防ぐ)。
// App から「当たり判定の配線」という単一の DOM 関心を切り出したフック(会話/音声 state には触れない)。

function rectContains(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

interface ClickThroughRefs {
  charRef: RefObject<CharacterDisplayHandle>;
  bubbleRef: RefObject<HTMLElement>;
  inputRef: RefObject<HTMLElement>;
  micButtonRef: RefObject<HTMLElement>;
  gearRef: RefObject<HTMLElement>;
  vrmPanelRef: RefObject<HTMLElement>;
}

export function useClickThrough(refs: ClickThroughRefs): void {
  const { charRef, bubbleRef, inputRef, micButtonRef, gearRef, vrmPanelRef } = refs;
  const lastIgnoreRef = useRef<boolean | null>(null);

  useEffect(() => {
    let pending = false;
    let mx = 0;
    let my = 0;
    const evaluate = (): void => {
      pending = false;
      const interactive =
        (charRef.current?.isOpaqueAt(mx, my) ?? true) ||
        rectContains(bubbleRef.current, mx, my) ||
        rectContains(inputRef.current, mx, my) ||
        rectContains(micButtonRef.current, mx, my) ||
        rectContains(gearRef.current, mx, my) ||
        rectContains(vrmPanelRef.current, mx, my);
      const ignore = !interactive;
      if (lastIgnoreRef.current !== ignore) {
        lastIgnoreRef.current = ignore;
        void window.ene.setIgnoreMouseEvents(ignore);
      }
    };
    const onMove = (e: MouseEvent): void => {
      mx = e.clientX;
      my = e.clientY;
      if (!pending) {
        pending = true;
        requestAnimationFrame(evaluate);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [charRef, bubbleRef, inputRef, micButtonRef, gearRef, vrmPanelRef]);
}

import { useEffect, useRef, type RefObject } from 'react';
import type { CharacterDisplayHandle } from './components/CharacterDisplay';

// クリックスルー判定 ＋ ホバー判定(§8.6 / UI改修 2026-06)。
// - 不透過(マウスを受ける)= キャラ不透明 OR 操作オーバーレイ OR 吹き出し OR VRM調整パネル の上。
//   それ以外は透過(下のウィンドウへマウスを通す)。
// - ホバー(操作オーバーレイの表示判定)= キャラ不透明 OR 操作オーバーレイ の上。
//   操作はキャラの不透明部に重ねて出すため、ホバー領域が地続きになり「手を伸ばすと消える」が起きない。
// 判定には VRM のレイキャスト(やや重い)が含まれるため、mousemove ごとでなく rAF で1フレーム1回に間引く。
// App から「当たり判定の配線」という単一の DOM 関心を切り出したフック(会話/音声 state には触れない)。

function rectContains(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

interface ClickThroughRefs {
  charRef: RefObject<CharacterDisplayHandle>;
  bubbleRef: RefObject<HTMLElement>;
  overlayRef: RefObject<HTMLElement>;
  vrmPanelRef: RefObject<HTMLElement>;
}

export function useClickThrough(
  refs: ClickThroughRefs,
  onHoverChange?: (hovered: boolean) => void,
): void {
  const { charRef, bubbleRef, overlayRef, vrmPanelRef } = refs;
  const lastIgnoreRef = useRef<boolean | null>(null);
  const lastHoveredRef = useRef<boolean | null>(null);
  // 親が毎レンダーで新しい関数を渡しても mousemove を貼り直さないよう、コールバックは ref 越しに読む。
  const hoverCbRef = useRef(onHoverChange);
  useEffect(() => {
    hoverCbRef.current = onHoverChange;
  });

  useEffect(() => {
    let pending = false;
    let mx = 0;
    let my = 0;
    const evaluate = (): void => {
      pending = false;
      const overChar = charRef.current?.isOpaqueAt(mx, my) ?? true;
      const overOverlay = rectContains(overlayRef.current, mx, my);
      const interactive =
        overChar ||
        overOverlay ||
        rectContains(bubbleRef.current, mx, my) ||
        rectContains(vrmPanelRef.current, mx, my);
      const ignore = !interactive;
      if (lastIgnoreRef.current !== ignore) {
        lastIgnoreRef.current = ignore;
        void window.ene.setIgnoreMouseEvents(ignore);
      }
      const hovered = overChar || overOverlay;
      if (lastHoveredRef.current !== hovered) {
        lastHoveredRef.current = hovered;
        hoverCbRef.current?.(hovered);
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
  }, [charRef, bubbleRef, overlayRef, vrmPanelRef]);
}

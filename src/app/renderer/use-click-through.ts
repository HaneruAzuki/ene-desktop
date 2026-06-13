import { useEffect, useRef, type RefObject } from 'react';
import type { CharacterDisplayHandle } from './components/CharacterDisplay';

// クリックスルー判定 ＋ ホバー判定(§8.6 / UI改修 2026-06)。
// - 不透過(マウスを受ける)= キャラ不透明 OR 操作オーバーレイ OR 吹き出し OR VRM調整パネル の上。
//   それ以外は透過(下のウィンドウへマウスを通す)。
// - ホバー(操作オーバーレイの表示判定)= キャラ不透明 OR 操作オーバーレイ の上。
//   操作はキャラの不透明部に重ねて出すため、ホバー領域が地続きになり「手を伸ばすと消える」が起きない。
//
// ⚠ 固着対策(2026-06): 評価を rAF で回すと、ウィンドウ最小化中は rAF が停止し、復帰後に評価が
//   走らず「全クリックスルーのまま固着(ホバー/ドラッグ不能)」になり得る。そのため rAF をやめ、
//   ページ可視性に依存しない「時間スロットル(約60fps)＋末尾取りこぼし防止のトレーリング評価」にした。
//   当たり判定は VRM=readPixels(1px) / PNG=alpha で十分軽いので、ほぼ毎ムーブ評価でも問題ない。

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
    let mx = 0;
    let my = 0;
    let lastEval = 0;
    let trailTimer: ReturnType<typeof setTimeout> | null = null;
    const evaluate = (): void => {
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
      const now = performance.now();
      if (now - lastEval >= 16) {
        lastEval = now;
        if (trailTimer) {
          clearTimeout(trailTimer);
          trailTimer = null;
        }
        evaluate();
      } else {
        // 直近の評価から間もない=末尾(最終位置)を取りこぼさないようトレーリング評価を予約。
        if (trailTimer) clearTimeout(trailTimer);
        trailTimer = setTimeout(() => {
          trailTimer = null;
          lastEval = performance.now();
          evaluate();
        }, 20);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (trailTimer) clearTimeout(trailTimer);
    };
  }, [charRef, bubbleRef, overlayRef, vrmPanelRef]);
}

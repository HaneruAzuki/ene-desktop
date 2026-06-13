import { useEffect, useRef, type RefObject } from 'react';
import type { CharacterDisplayHandle } from './components/CharacterDisplay';

// クリックスルー判定(§8.6 / UI改修 2026-06)。
// 不透過(マウスを受ける)= キャラ不透明 OR 操作オーバーレイ OR 吹き出し OR VRM調整パネル の上。
// それ以外は透過(下のウィンドウへマウスを通す)。
//
// ⚠ 固着対策(2026-06): 評価を rAF で回すと最小化中に rAF が停止し、復帰後に評価が走らず
//   全クリックスルー固着になり得る。rAF をやめ、ページ可視性に依存しない時間スロットル
//   (約60fps＋末尾トレーリング)にした。当たり判定は readPixels(1px)/alpha で十分軽い。
//
// 注: 操作バーの「表示/非表示」はキャラ形状に依存すると固着しやすいため、ここでは扱わない。
//     App 側の「下部の固定ゾーン(矩形)」で別途判定する(案A・段階5 修正)。

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
  /** 会話ログのトグル(>>)とログ枠。開いている間/トグル上は不透過に保つ(VTuber風)。 */
  logToggleRef: RefObject<HTMLElement>;
  logPanelRef: RefObject<HTMLElement>;
}

export function useClickThrough(refs: ClickThroughRefs): void {
  const { charRef, bubbleRef, overlayRef, vrmPanelRef, logToggleRef, logPanelRef } = refs;
  const lastIgnoreRef = useRef<boolean | null>(null);

  useEffect(() => {
    let mx = 0;
    let my = 0;
    let lastEval = 0;
    let trailTimer: ReturnType<typeof setTimeout> | null = null;
    const evaluate = (): void => {
      const interactive =
        (charRef.current?.isOpaqueAt(mx, my) ?? true) ||
        rectContains(overlayRef.current, mx, my) ||
        rectContains(bubbleRef.current, mx, my) ||
        rectContains(vrmPanelRef.current, mx, my) ||
        rectContains(logToggleRef.current, mx, my) ||
        rectContains(logPanelRef.current, mx, my);
      const ignore = !interactive;
      if (lastIgnoreRef.current !== ignore) {
        lastIgnoreRef.current = ignore;
        void window.ene.setIgnoreMouseEvents(ignore);
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
  }, [charRef, bubbleRef, overlayRef, vrmPanelRef, logToggleRef, logPanelRef]);
}

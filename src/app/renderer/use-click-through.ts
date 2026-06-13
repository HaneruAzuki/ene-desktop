import { useEffect, useRef, type RefObject } from 'react';
import type { CharacterDisplayHandle } from './components/CharacterDisplay';

// クリックスルー判定(§8.6 / UI改修 2026-06)。
// 不透過(マウスを受ける)= キャラ不透明 OR 操作オーバーレイ OR 吹き出し OR 設定パネル OR 会話ログ の上。
// それ以外は透過(下のウィンドウへマウスを通す)。
//
// ⚠ 固着対策(2026-06・再発防止の決定版): ignore=true(全クリックスルー)で固まると、ウィンドウが
//   マウスイベントを受けず再評価できないため、ホバーもドラッグも効かなくなる。トリガは主に2つ:
//   (A) HMR の page reload 後、reload 前の ignore=true 状態がウィンドウに残る。
//   (B) スリープ/GPU リセットで WebGL コンテキスト喪失 → readPixels が透明を返す(isHit 側で対処済)。
//   対策:
//   1) マウント直後(=reload 後を含む)に必ず ignore=false(操作可能)へリセットして固着の起点を断つ。
//   2) マウス位置の起点をウィンドウ中央(トリミの上)に置き、未移動でも「操作可能」に倒す。
//   3) mousemove に依存しない定期ハートビートで最後の位置を再評価=何かの拍子に固まっても自己回復する。
//   評価を rAF で回さないのは、最小化中に rAF が止まり復帰後に評価されないため(時間スロットル+ハートビート)。
//
// 注: 操作バーの「表示/非表示」はキャラ形状に依存すると固着しやすいため、ここでは扱わない。
//     App 側の「下部の固定ゾーン(矩形)」で別途判定する(案A・段階5 修正)。

/** 固着しても最大この間隔(ms)で最後のマウス位置を再評価して自己回復する。 */
const HEARTBEAT_MS = 600;

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
    // 起点はウィンドウ中央(トリミの上)=評価前/未移動でも「操作可能」へ倒す(固着の起点を作らない)。
    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let lastEval = 0;
    let trailTimer: ReturnType<typeof setTimeout> | null = null;

    const apply = (ignore: boolean): void => {
      if (lastIgnoreRef.current !== ignore) {
        lastIgnoreRef.current = ignore;
        void window.ene.setIgnoreMouseEvents(ignore);
      }
    };
    const evaluate = (): void => {
      const interactive =
        (charRef.current?.isOpaqueAt(mx, my) ?? true) ||
        rectContains(overlayRef.current, mx, my) ||
        rectContains(bubbleRef.current, mx, my) ||
        rectContains(vrmPanelRef.current, mx, my) ||
        rectContains(logToggleRef.current, mx, my) ||
        rectContains(logPanelRef.current, mx, my);
      apply(!interactive);
    };

    // (1) マウント直後(HMR reload 後を含む)は必ず「操作可能」から始める。reload 前の ignore=true が
    //     ウィンドウに残ったまま再評価されず固着する経路を断つ。state も false に揃える。
    lastIgnoreRef.current = null;
    void window.ene.setIgnoreMouseEvents(false);
    lastIgnoreRef.current = false;

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

    // (3) 固着の保険: マウスが動かなくても定期的に最後の位置で再評価する。
    //     何かの拍子に ignore=true で固まっても、最大 HEARTBEAT_MS で自己回復する(mousemove 非依存)。
    const heartbeat = setInterval(evaluate, HEARTBEAT_MS);

    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      clearInterval(heartbeat);
      if (trailTimer) clearTimeout(trailTimer);
    };
  }, [charRef, bubbleRef, overlayRef, vrmPanelRef, logToggleRef, logPanelRef]);
}

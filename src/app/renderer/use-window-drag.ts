import { useEffect, useRef, type RefObject, type MouseEvent as ReactMouseEvent } from 'react';
import { exceedsDragThreshold, classifyGesture, computeWindowTopLeft } from './mouse-gesture';
import type { VrmRenderer } from './vrm-renderer';

// キャラのドラッグ移動(押下→閾値超えでドラッグ判定→ウィンドウ移動 / 閾値内ならクリック)。
// CharacterDisplay から「窓ドラッグ」という単一責務を切り出したフック。判別ロジック自体は
// 純粋関数(mouse-gesture.ts・単体テスト対象)で、本フックはその配線(リスナ・rAF 間引き・後始末)を担う。

interface PressState {
  startX: number;
  startY: number;
  startTime: number;
  grabX: number;
  grabY: number;
  isDragging: boolean;
}

/**
 * 押下ハンドラ(onMouseDown)を返す。
 *  - rendererRef: ドラッグ中は VRM 描画を止めて移動を滑らかにする(無ければ PNG モード=無視)。
 *  - onClick: 閾値内の押下(=クリック)で呼ぶ。最新値を ref 経由で参照する。
 * 位置反映は rAF で1フレーム1回に間引き、アンマウント時は途中ドラッグのリスナ/予約 rAF を確実に外す。
 */
export function useWindowDrag(
  rendererRef: RefObject<VrmRenderer | null>,
  onClick: () => void,
): { onMouseDown: (e: ReactMouseEvent) => void } {
  const onClickRef = useRef(onClick);
  const rafRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  // ドラッグ中(押下中)に window へ張った mousemove/mouseup ハンドラ。アンマウント時に確実に外すため保持する
  // (通常は mouseup 内で外れるが、ドラッグ途中のアンマウントでは外れず漏れる)。
  const dragHandlersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  function flushMove(): void {
    rafRef.current = null;
    const pos = pendingPosRef.current;
    if (pos) {
      void window.ene.moveWindow(pos.x, pos.y);
      pendingPosRef.current = null;
    }
  }
  function scheduleMove(x: number, y: number): void {
    pendingPosRef.current = { x, y };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushMove);
    }
  }

  function onMouseDown(e: ReactMouseEvent): void {
    const press: PressState = {
      startX: e.screenX,
      startY: e.screenY,
      startTime: Date.now(),
      grabX: e.clientX,
      grabY: e.clientY,
      isDragging: false,
    };
    const onMove = (ev: MouseEvent): void => {
      if (!press.isDragging && exceedsDragThreshold(ev.screenX - press.startX, ev.screenY - press.startY)) {
        press.isDragging = true;
        rendererRef.current?.setDragging(true); // ドラッグ中は VRM 描画を止めて移動を滑らかに
      }
      if (press.isDragging) {
        const pos = computeWindowTopLeft(ev.screenX, ev.screenY, press.grabX, press.grabY);
        scheduleMove(pos.x, pos.y);
      }
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragHandlersRef.current = null;
      if (press.isDragging) rendererRef.current?.setDragging(false);
      const gesture = classifyGesture(Date.now() - press.startTime, press.isDragging);
      if (gesture === 'click') {
        onClickRef.current();
      }
    };
    dragHandlersRef.current = { move: onMove, up: onUp };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // アンマウント時のクリーンアップ: ドラッグ途中(mouseup 未到来)でも window リスナーを外し、
  // 予約済みの位置反映 rAF をキャンセルする(リーク防止)。
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const handlers = dragHandlersRef.current;
      if (handlers) {
        window.removeEventListener('mousemove', handlers.move);
        window.removeEventListener('mouseup', handlers.up);
        dragHandlersRef.current = null;
      }
    };
  }, []);

  return { onMouseDown };
}

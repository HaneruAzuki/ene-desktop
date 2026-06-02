import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { exceedsDragThreshold, classifyGesture, computeWindowTopLeft } from '../mouse-gesture';

// キャラ表示 + マウス操作判別 + 透明ピクセル判定の提供(設計書 §8.2 / §8.6)。

export interface CharacterDisplayHandle {
  /** 表示座標(clientX/Y)がキャラの不透明ピクセル上かを返す。 */
  isOpaqueAt(clientX: number, clientY: number): boolean;
}

interface Props {
  portraitUrl: string;
  onClick: () => void;
}

interface PressState {
  startX: number;
  startY: number;
  startTime: number;
  grabX: number;
  grabY: number;
  isDragging: boolean;
}

export const CharacterDisplay = forwardRef<CharacterDisplayHandle, Props>(
  function CharacterDisplay({ portraitUrl, onClick }, ref) {
    const imgRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const onClickRef = useRef(onClick);
    const rafRef = useRef<number | null>(null);
    const pendingPosRef = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
      onClickRef.current = onClick;
    }, [onClick]);

    // 画像を canvas に描画(alpha 読取用)
    function drawToCanvas(): void {
      const img = imgRef.current;
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      canvasRef.current = canvas;
    }
    useEffect(() => {
      drawToCanvas();
    }, [portraitUrl]);

    useImperativeHandle(
      ref,
      () => ({
        isOpaqueAt(clientX: number, clientY: number): boolean {
          const img = imgRef.current;
          const canvas = canvasRef.current;
          if (!img || !canvas) return true; // 未準備なら安全側(不透明扱い)
          const rect = img.getBoundingClientRect();
          if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
            return false;
          }
          const sx = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
          const sy = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
          try {
            const alpha = canvas.getContext('2d')?.getImageData(sx, sy, 1, 1).data[3] ?? 255;
            return alpha > 0;
          } catch {
            return true;
          }
        },
      }),
      [],
    );

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

    function onMouseDown(e: React.MouseEvent): void {
      const press: PressState = {
        startX: e.screenX,
        startY: e.screenY,
        startTime: Date.now(),
        grabX: e.clientX,
        grabY: e.clientY,
        isDragging: false,
      };

      // window レベルで move/up を拾う(キャラ外に出ても追従・取りこぼし防止)。
      const onMove = (ev: MouseEvent): void => {
        if (!press.isDragging && exceedsDragThreshold(ev.screenX - press.startX, ev.screenY - press.startY)) {
          press.isDragging = true;
        }
        if (press.isDragging) {
          const pos = computeWindowTopLeft(ev.screenX, ev.screenY, press.grabX, press.grabY);
          scheduleMove(pos.x, pos.y);
        }
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const gesture = classifyGesture(Date.now() - press.startTime, press.isDragging);
        if (gesture === 'click') {
          onClickRef.current();
        }
        // drag / longpress は何もしない
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    function onContextMenu(e: React.MouseEvent): void {
      e.preventDefault();
      void window.ene.showCharacterContextMenu();
    }

    return (
      <img
        ref={imgRef}
        className="character"
        src={portraitUrl}
        alt="ENE"
        draggable={false}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        onLoad={drawToCanvas}
      />
    );
  },
);

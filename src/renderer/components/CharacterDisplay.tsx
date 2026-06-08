import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { exceedsDragThreshold, classifyGesture, computeWindowTopLeft } from '../mouse-gesture';
import { resolveFrame } from '../resolve-frame';
import { MOUTH_FLAP_MS } from '../constants';
import type { CharacterAnimationData, CharacterState } from '../../shared/types/animation';

// キャラ表示 + マウス操作判別 + 透明ピクセル判定(設計書 §8.2 / §8.6 / task_13)。
// アニメ定義があれば状態機械でフレームを切り替え、無ければ単一 portrait 表示(F-ANIM-11)。

export interface CharacterDisplayHandle {
  /** 表示座標(clientX/Y)がキャラの不透明ピクセル上かを返す(現フレームの alpha・F-ANIM-08)。 */
  isOpaqueAt(clientX: number, clientY: number): boolean;
}

interface Props {
  portraitUrl: string; // フォールバック(アニメ無し時)
  animation?: CharacterAnimationData;
  state: CharacterState;
  /** 増えるたびに1回うなずく(相槌の非言語表現・task_18 Phase B)。 */
  nodKey?: number;
  onClick: () => void;
}

/** うなずきアニメの長さ(ms・CSS の ene-nod と合わせる)。 */
const NOD_MS = 500;

interface PressState {
  startX: number;
  startY: number;
  startTime: number;
  grabX: number;
  grabY: number;
  isDragging: boolean;
}

export const CharacterDisplay = forwardRef<CharacterDisplayHandle, Props>(
  function CharacterDisplay({ portraitUrl, animation, state, nodKey, onClick }, ref) {
    const imgRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const onClickRef = useRef(onClick);
    const rafRef = useRef<number | null>(null);
    const pendingPosRef = useRef<{ x: number; y: number } | null>(null);

    // 口パク(talking 中のみ開閉トグル)。
    const [flapOpen, setFlapOpen] = useState(false);
    // うなずき(相槌・task_18): nodKey が増えた瞬間に短時間 true。
    const [nodding, setNodding] = useState(false);

    useEffect(() => {
      onClickRef.current = onClick;
    }, [onClick]);

    useEffect(() => {
      if (state.activity !== 'talking') {
        setFlapOpen(false);
        return;
      }
      const ms = animation?.timing?.mouthFlapMs ?? MOUTH_FLAP_MS;
      const id = setInterval(() => setFlapOpen((o) => !o), ms);
      return () => clearInterval(id);
    }, [state.activity, animation]);

    // 現フレームの dataURL を解決(アニメ無し or フレーム欠落は portrait へ)。
    const frameKey = animation ? resolveFrame(animation, state, flapOpen) : null;
    const displaySrc = (frameKey && animation?.frames[frameKey]) || portraitUrl;

    // 表示中フレームを canvas へ描画(alpha 読取用)。src が変わるたび再描画(F-ANIM-08)。
    function drawToCanvas(): void {
      const img = imgRef.current;
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvasRef.current = canvas;
    }
    useEffect(() => {
      drawToCanvas();
    }, [displaySrc]);

    // 相槌のうなずき: nodKey 変化で短時間だけ nod クラスを当てる(0/未指定は無視)。
    useEffect(() => {
      if (!nodKey) return;
      setNodding(true);
      const id = setTimeout(() => setNodding(false), NOD_MS);
      return () => clearTimeout(id);
    }, [nodKey]);

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
          // object-fit: contain のため、表示矩形内の letterbox を考慮して画像実領域へ写像する。
          const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
          const drawnW = canvas.width * scale;
          const drawnH = canvas.height * scale;
          const offX = (rect.width - drawnW) / 2;
          const offY = (rect.height - drawnH) / 2;
          const localX = clientX - rect.left - offX;
          const localY = clientY - rect.top - offY;
          if (localX < 0 || localX >= drawnW || localY < 0 || localY >= drawnH) return false; // letterbox 余白
          const sx = Math.floor(localX / scale);
          const sy = Math.floor(localY / scale);
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

    // 呼吸の微動は idle 中のみ(CSS keyframes・スプライト不要・F-ANIM-03)。
    // うなずき(相槌)は最後に付け、breathe より後勝ちで一時的に上書きする(CSS の定義順)。
    const classes = ['character'];
    if (state.activity === 'idle') classes.push('character--breathe');
    if (nodding) classes.push('character--nod');
    const className = classes.join(' ');

    return (
      <img
        ref={imgRef}
        className={className}
        src={displaySrc}
        alt="ENE"
        draggable={false}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        onLoad={drawToCanvas}
      />
    );
  },
);

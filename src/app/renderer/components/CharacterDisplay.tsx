import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { resolveFrame } from '../resolve-frame';
import { MOUTH_FLAP_MS } from '../constants';
import { VrmRenderer } from '../vrm-renderer';
import { useWindowDrag } from '../use-window-drag';
import type { CharacterAnimationData, CharacterState } from '../../../shared/types/animation';
import type { VrmRenderConfig, VrmDisplayParams } from '../../../shared/types/vrm';

// キャラ表示 + マウス操作判別 + 当たり判定(設計書 §8.2 / §8.6 / task_13 / F・3D化)。
// VRM 設定とモデルが揃えば VRM(three-vrm)で描画し、欠ければ PNG 立ち絵へフォールバック(§3.7)。
// クリックスルー判定(isOpaqueAt)は VRM=レイキャスト / PNG=現フレーム alpha で切り替える。

export interface CharacterDisplayHandle {
  /** 表示座標(clientX/Y)がキャラ上(不透明/メッシュ)かを返す(クリックスルー・§8.6)。 */
  isOpaqueAt(clientX: number, clientY: number): boolean;
}

interface Props {
  portraitUrl: string; // フォールバック(VRM/アニメ無し時)
  animation?: CharacterAnimationData;
  state: CharacterState;
  /** 増えるたびに1回うなずく(相槌の非言語表現・task_18 Phase B)。 */
  nodKey?: number;
  /** うなずきの深さ(相槌=1.0 / ターン終端=発話長で出し分け・2026-06-12)。未指定は 1.0。 */
  nodStrength?: number;
  onClick: () => void;
  // --- VRM(F)。両方揃えば VRM モード、欠ければ PNG フォールバック ---
  vrmConfig?: VrmRenderConfig | null;
  vrmModel?: ArrayBuffer | null;
  /** 表示パラメータ(GUI スライダーの実効値)。未指定なら vrmConfig.display を使う。 */
  vrmDisplay?: VrmDisplayParams;
  /** 再生中の音声振幅(0〜1)を返す関数(振幅ドリブンのリップシンク)。 */
  amplitudeProvider?: () => number;
  /** ウィンドウ可視性(false=非表示/最小化→VRM 描画停止)。 */
  visible?: boolean;
}

/** うなずきアニメの長さ(ms・CSS の ene-nod と合わせる・PNG モード用)。1.5倍ゆっくりに(2026-06-12)。 */
const NOD_MS = 830;

export const CharacterDisplay = forwardRef<CharacterDisplayHandle, Props>(
  function CharacterDisplay(
    { portraitUrl, animation, state, nodKey, nodStrength = 1, onClick, vrmConfig, vrmModel, vrmDisplay, amplitudeProvider, visible = true },
    ref,
  ) {
    const imgRef = useRef<HTMLImageElement>(null);
    const alphaCanvasRef = useRef<HTMLCanvasElement | null>(null); // PNG alpha 読取用(2D)
    const glCanvasRef = useRef<HTMLCanvasElement>(null); // VRM 描画用(WebGL)
    const rendererRef = useRef<VrmRenderer | null>(null);
    const stateRef = useRef(state);

    // 口パク(PNG モードの talking 中のみ開閉トグル)。
    const [flapOpen, setFlapOpen] = useState(false);
    // うなずき(PNG モード・CSS)。
    const [nodding, setNodding] = useState(false);
    // VRM のロード失敗(=PNG フォールバックへ)。
    const [vrmFailed, setVrmFailed] = useState(false);

    const vrmMode = !!(vrmConfig && vrmModel && !vrmFailed);

    // ドラッグ移動(押下→閾値超えで移動 / 閾値内ならクリック)は専用フックへ分離(振る舞い不変)。
    const { onMouseDown } = useWindowDrag(rendererRef, onClick);

    useEffect(() => {
      stateRef.current = state;
    }, [state]);

    // --- VRM レンダラのライフサイクル(設定＋モデルが揃ったら生成・破棄でクリーンアップ) ---
    useEffect(() => {
      const canvas = glCanvasRef.current;
      if (!vrmConfig || !vrmModel || !canvas) return;
      let disposed = false;
      const renderer = new VrmRenderer({
        canvas,
        expressionMap: vrmConfig.expressionMap,
        display: vrmDisplay ?? vrmConfig.display,
        amplitudeProvider: amplitudeProvider ?? ((): number => 0),
      });
      renderer
        .loadModel(vrmModel)
        .then(() => {
          if (disposed) {
            renderer.dispose();
            return;
          }
          rendererRef.current = renderer;
          renderer.setEmotion(stateRef.current.emotion);
          renderer.setTalking(stateRef.current.activity === 'talking');
          renderer.setVisible(visible);
        })
        .catch(() => {
          // 読込失敗=低スペック/破損等 → PNG 立ち絵へフォールバック(§3.7)。
          renderer.dispose();
          setVrmFailed(true);
        });
      return () => {
        disposed = true;
        rendererRef.current?.dispose();
        rendererRef.current = null;
      };
      // モデル/設定が変わった時のみ作り直す(emotion 等は別 effect で反映)。
    }, [vrmConfig, vrmModel]);

    // 感情・talking を VRM へ反映。
    useEffect(() => {
      const r = rendererRef.current;
      if (!r) return;
      r.setEmotion(state.emotion);
      r.setTalking(state.activity === 'talking');
    }, [state.emotion, state.activity, vrmMode]);

    // 表示パラメータの即時反映(GUI スライダー)。
    useEffect(() => {
      if (vrmDisplay) rendererRef.current?.setDisplay(vrmDisplay);
    }, [vrmDisplay]);

    // 可視性 → 描画の開始/停止(非表示で常駐コスト 0・§3.6)。
    useEffect(() => {
      rendererRef.current?.setVisible(visible);
    }, [visible, vrmMode]);

    // ウィンドウのリサイズに追従。
    useEffect(() => {
      if (!vrmMode) return;
      const onResize = (): void => rendererRef.current?.resize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, [vrmMode]);

    // うなずき(相槌＝聞くターン / ターン終端＝無音窓終端): VRM はボーン、PNG は CSS クラスで表現(0/未指定は無視)。
    //   nodStrength=深さ(相槌 1.0 / ターン終端は発話長で出し分け)。VRM は回転量、PNG は CSS 変数 --nod-scale を倍率に。
    useEffect(() => {
      if (!nodKey) return;
      if (rendererRef.current) {
        rendererRef.current.nod(nodStrength);
      } else {
        setNodding(true);
        const id = setTimeout(() => setNodding(false), NOD_MS);
        return () => clearTimeout(id);
      }
    }, [nodKey, nodStrength]);

    // --- 以降は PNG モードの口パク・フレーム解決・alpha 描画(VRM モードでは未使用) ---
    useEffect(() => {
      if (vrmMode) return;
      if (state.activity !== 'talking') {
        setFlapOpen(false);
        return;
      }
      const ms = animation?.timing?.mouthFlapMs ?? MOUTH_FLAP_MS;
      const id = setInterval(() => setFlapOpen((o) => !o), ms);
      return () => clearInterval(id);
    }, [state.activity, animation, vrmMode]);

    const frameKey = animation ? resolveFrame(animation, state, flapOpen) : null;
    const displaySrc = (frameKey && animation?.frames[frameKey]) || portraitUrl;

    function drawToCanvas(): void {
      const img = imgRef.current;
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const canvas = alphaCanvasRef.current ?? document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      alphaCanvasRef.current = canvas;
    }
    useEffect(() => {
      if (!vrmMode) drawToCanvas();
    }, [displaySrc, vrmMode]);

    useImperativeHandle(
      ref,
      () => ({
        isOpaqueAt(clientX: number, clientY: number): boolean {
          // VRM モード: メッシュへのレイキャストで判定(案A・透過浮遊)。
          const renderer = rendererRef.current;
          if (renderer) return renderer.isHit(clientX, clientY);

          // PNG モード: 現フレームの alpha を 2D canvas から読む(F-ANIM-08)。
          const img = imgRef.current;
          const canvas = alphaCanvasRef.current;
          if (!img || !canvas) return true; // 未準備なら安全側(不透明扱い)
          const rect = img.getBoundingClientRect();
          if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
            return false;
          }
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

    function onContextMenu(e: React.MouseEvent): void {
      e.preventDefault();
      void window.ene.showCharacterContextMenu();
    }

    // VRM モード: WebGL キャンバス(背景透過・浮遊)。
    if (vrmMode) {
      return (
        <canvas
          ref={glCanvasRef}
          className="character character--vrm"
          onMouseDown={onMouseDown}
          onContextMenu={onContextMenu}
        />
      );
    }

    // PNG フォールバック(従来の立ち絵・breathe/nod は CSS)。
    const classes = ['character'];
    if (state.activity === 'idle') classes.push('character--breathe');
    if (nodding) classes.push('character--nod');

    return (
      <img
        ref={imgRef}
        className={classes.join(' ')}
        src={displaySrc}
        alt="魚川トリミ"
        draggable={false}
        // うなずきの深さを CSS 変数で渡す(ene-nod の translateY 倍率)。非うなずき時は無指定。
        style={nodding ? ({ ['--nod-scale']: String(nodStrength) } as React.CSSProperties) : undefined}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        onLoad={drawToCanvas}
      />
    );
  },
);

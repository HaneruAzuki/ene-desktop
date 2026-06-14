import React, { useEffect, useRef, useState } from 'react';
import { VrmRenderer } from '../vrm-renderer';
import { useWindowDrag } from '../use-window-drag';
import type { CharacterState } from '../../../shared/types/animation';
import type { VrmRenderConfig, VrmDisplayParams } from '../../../shared/types/vrm';

// キャラ表示(VRM・three-vrm)＋ マウス操作判別(設計書 §8.2 / task_13 / F・3D化)。
// 表示は VRM 一本。2026-06 に PNG 立ち絵フォールバックを撤去した(あらゆる挙動を VRM/PNG で二重実装する
//   負担を排除し、複雑さを下げるため)。WebGL 初期化不可・モデル読込失敗など VRM を出せない稀な場合は、
//   代替表示は持たず、トリミ口調の短いメッセージだけ出す。
// クリックスルー判定は専用ヒットボックス(.character-hitbox)で行う(イベント駆動・use-interaction-routing.ts)。

interface Props {
  state: CharacterState;
  /** 増えるたびに1回うなずく(相槌の非言語表現・task_18 Phase B)。 */
  nodKey?: number;
  /** うなずきの深さ(相槌=1.0 / ターン終端=発話長で出し分け・2026-06-12)。未指定は 1.0。 */
  nodStrength?: number;
  /** 増えるたびに1回あくびする(長時間傾聴の情緒ビート・listening-mode)。 */
  yawnKey?: number;
  /** 傾聴モード中か(少し首をかしげる・listening-mode)。 */
  listening?: boolean;
  onClick: () => void;
  // --- VRM(F)。設定とモデルが揃えば描画。揃わない/失敗時は短いメッセージのみ ---
  vrmConfig?: VrmRenderConfig | null;
  vrmModel?: ArrayBuffer | null;
  /** 表示パラメータ(GUI スライダーの実効値)。未指定なら vrmConfig.display を使う。 */
  vrmDisplay?: VrmDisplayParams;
  /** 再生中の音声振幅(0〜1)を返す関数(振幅ドリブンのリップシンク)。 */
  amplitudeProvider?: () => number;
  /** ウィンドウ可視性(false=非表示/最小化→VRM 描画停止)。 */
  visible?: boolean;
  /** 離席中(UI改修 段階5)。VRM は後ろを向く。 */
  away?: boolean;
  /** 準備中(起動ウォーム中・2026-06-14)。頭だけ下から覗く姿勢(VRM=カメラ)。 */
  preparing?: boolean;
  /** クリックスルー判定(シルエット)を外へ公開する ref。レンダラの isOpaqueAt を差し込む(use-interaction-routing が参照)。 */
  hitTestRef?: React.MutableRefObject<((x: number, y: number) => boolean) | null>;
}

export function CharacterDisplay({
  state,
  nodKey,
  nodStrength = 1,
  yawnKey,
  listening = false,
  onClick,
  vrmConfig,
  vrmModel,
  vrmDisplay,
  amplitudeProvider,
  visible = true,
  away = false,
  preparing = false,
  hitTestRef,
}: Props): React.ReactElement {
  // 生成時の覗き状態を effect 外(レンダラ生成 effect・deps に preparing を入れない)から読むための ref。
  const preparingRef = useRef(preparing);
  preparingRef.current = preparing;
  const glCanvasRef = useRef<HTMLCanvasElement>(null); // VRM 描画用(WebGL)
  const rendererRef = useRef<VrmRenderer | null>(null);
  const stateRef = useRef(state);
  // VRM を出せなかった(WebGL 初期化不可 / モデル読込失敗)。立ち絵の代替は持たないので一言だけ出す。
  const [vrmFailed, setVrmFailed] = useState(false);

  // ドラッグ移動(押下→閾値超えで移動 / 閾値内ならクリック)は専用フックへ分離。
  const { onMouseDown } = useWindowDrag(rendererRef, onClick);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // --- VRM レンダラのライフサイクル(設定＋モデルが揃ったら生成・破棄でクリーンアップ) ---
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!vrmConfig || !vrmModel || !canvas) return;
    let disposed = false;
    let renderer: VrmRenderer;
    try {
      renderer = new VrmRenderer({
        canvas,
        expressionMap: vrmConfig.expressionMap,
        display: vrmDisplay ?? vrmConfig.display,
        amplitudeProvider: amplitudeProvider ?? ((): number => 0),
        peek: preparingRef.current, // 準備中なら頭だけ覗く姿勢から始める
      });
    } catch {
      // WebGL 初期化不可など(古いGPU/ドライバ/一部の VM・RDP)。代替表示は持たないので一言だけ。
      setVrmFailed(true);
      return;
    }
    renderer
      .loadModel(vrmModel)
      .then(() => {
        if (disposed) {
          renderer.dispose();
          return;
        }
        rendererRef.current = renderer;
        // クリックスルー判定(シルエット)を外へ公開: use-interaction-routing がこの関数で透過/非透過を決める。
        if (hitTestRef) hitTestRef.current = (x, y) => renderer.isOpaqueAt(x, y);
        setVrmFailed(false);
        renderer.setEmotion(stateRef.current.emotion);
        renderer.setTalking(stateRef.current.activity === 'talking');
        renderer.setVisible(visible);
        renderer.setPeek(preparingRef.current); // ロード完了時点の準備状態を反映
      })
      .catch(() => {
        // モデルが壊れている/読めない → 代替表示は持たない(一言だけ)。
        renderer.dispose();
        setVrmFailed(true);
      });
    return () => {
      disposed = true;
      if (hitTestRef) hitTestRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // モデル/設定が変わった時のみ作り直す(emotion 等は別 effect で反映)。
  }, [vrmConfig, vrmModel]);

  // 感情・talking を VRM へ反映(レンダラ未準備時は無視。初期値はロード完了時に適用済み)。
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setEmotion(state.emotion);
    r.setTalking(state.activity === 'talking');
  }, [state.emotion, state.activity]);

  // 表示パラメータの即時反映(GUI スライダー)。
  useEffect(() => {
    if (vrmDisplay) rendererRef.current?.setDisplay(vrmDisplay);
  }, [vrmDisplay]);

  // 可視性 → 描画の開始/停止(非表示で常駐コスト 0・§3.6)。
  useEffect(() => {
    rendererRef.current?.setVisible(visible);
  }, [visible]);

  // 離席 → VRM は後ろを向く(段階5)。
  useEffect(() => {
    rendererRef.current?.setAway(away);
  }, [away]);

  // 準備中(起動ウォーム中)→ 頭だけ下から覗く。ready で通常姿勢へすっと起き上がる。
  useEffect(() => {
    rendererRef.current?.setPeek(preparing);
  }, [preparing]);

  // ウィンドウのリサイズに追従。
  useEffect(() => {
    const onResize = (): void => rendererRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // うなずき(相槌＝聞くターン / ターン終端＝無音窓終端): VRM のボーンで表現(0/未指定は無視)。
  useEffect(() => {
    if (!nodKey) return;
    rendererRef.current?.nod(nodStrength);
  }, [nodKey, nodStrength]);

  // あくび(長時間傾聴・listening-mode)。
  useEffect(() => {
    if (!yawnKey) return;
    rendererRef.current?.playYawn();
  }, [yawnKey]);

  // 傾聴モードの首かしげ(listening-mode)。
  useEffect(() => {
    rendererRef.current?.setListening(listening);
  }, [listening]);

  function onContextMenu(e: React.MouseEvent): void {
    // 右クリックメニューは廃止(2026-06 ユーザー方針)。既定メニューだけ抑止する
    // (完全終了はタスクバーのアイコン右クリック、各設定は⚙の設定パネルへ集約)。
    e.preventDefault();
  }

  return (
    <>
      {/* WebGL キャンバス。当たり判定はシルエット(isOpaqueAt)で行うので、キャンバス自身が押下を受ける
          (透明部の上ではコントローラが ignore=true にするので、その押下は下のデスクトップへ通る)。 */}
      <canvas
        ref={glCanvasRef}
        className="character character--vrm"
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
      />
      {/* VRM を出せない稀な場合(WebGL 不可/モデル破損)。代替表示は持たず、トリミ口調で一言だけ。 */}
      {vrmFailed && (
        <div className="character-error" data-interactive data-hitbox>
          …ごめん、うまく姿を出せないみたい。
        </div>
      )}
    </>
  );
}

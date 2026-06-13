import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { EmotionLabel } from '../../shared/types/animation';
import type { VrmDisplayParams, VrmExpressionMap } from '../../shared/types/vrm';
import { resolveExpressionWeights } from './vrm/expression-resolver';

// three-vrm 描画エンジン(F・3D化)。scripts/vrm-harness.html の実証済みロジックを移植。
// React 側(CharacterDisplay)は薄いラッパで、描画・表情・口パク・当たり判定は本クラスに集約する。
//
// 軽量原則(柱4・§3.6): 30fps 上限・非発話時は間引き・非表示中は完全停止。
// 透過浮遊(案A): WebGL を alpha 付きで描画し背景は透明クリア(クリックスルーはレイキャストで判定)。

/** 口形の母音キー(モデルのプリセット)。リップシンクは aa の開口量だけ動かす。 */
const VISEME_AA = 'aa';
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;

/** 口の最大開度(1.0=フルオープンは不自然なので抑える)と平滑化係数。 */
const MAX_MOUTH_OPEN = 0.7;
const MOUTH_SMOOTH = 0.4;
/** これ未満は完全に閉じる(話し終わりに微小値で開きっぱなしになるのを防ぐ)。 */
const MOUTH_CLOSE_EPS = 0.04;

/** フレーム上限。発話中は滑らかに、アイドル時は間引いて常駐 CPU を抑える。 */
const FPS_TALKING = 30;
const FPS_IDLE = 15;

/**
 * 1 ステップに渡す delta の安全上限。フレーム間引き・音声再生・一時ハングで acc が跳ねると
 * SpringBone(揺れ物理)が発散し、髪などが body から飛び出す。過大な dt を渡さないようクランプする。
 * 物理はさらに厳しめ(=安定して積分できる上限)に抑える。
 */
const MAX_FRAME_DELTA = 0.1;
const MAX_PHYSICS_DELTA = 1 / 30;

export interface VrmRendererOptions {
  canvas: HTMLCanvasElement;
  expressionMap: VrmExpressionMap;
  display: VrmDisplayParams;
  /** 再生中の音声振幅(0〜1)。毎フレーム読んで口の開きを駆動する(振幅ドリブン・B-05)。 */
  amplitudeProvider: () => number;
}

export class VrmRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly hitPixel = new Uint8Array(4); // クリックスルー判定の 1px alpha 読取用
  private readonly amplitudeProvider: () => number;

  private vrm: VRM | null = null;
  private expressionMap: VrmExpressionMap;
  private display: VrmDisplayParams;
  private headY = 1.35;

  private emotion: EmotionLabel = 'neutral';
  private talking = false;
  private blinkT = 0;
  private blinkPhase = 0;
  private nodPhase = 0; // うなずき(>0 の間だけ頭を下げる)
  private nodStrength = 1; // うなずきの深さ(相槌=1.0 / ターン終端=発話長で出し分け)
  private mouthOpen = 0; // 平滑化した開口量
  private acc = 0; // 30fps cap 用の時間アキュムレータ
  private rafId: number | null = null;
  private running = false;
  private dragging = false; // ドラッグ中は描画を止めてウィンドウ移動を優先
  private visible = true; // 可視状態(コンテキスト復帰時に可視中だけ描画を再開)
  private lastRenderMs = 0; // 最後に描画した時刻(クリックスルー固着のウォッチドッグ用)

  constructor(opts: VrmRendererOptions) {
    this.canvas = opts.canvas;
    this.expressionMap = opts.expressionMap;
    this.display = opts.display;
    this.amplitudeProvider = opts.amplitudeProvider;

    // preserveDrawingBuffer: クリックスルー判定で描画後バッファの alpha を readPixels するため必須
    // (描画停止中=ドラッグ中でも最後のフレームを読める)。
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0); // 透明背景(案A・浮遊)
    // WebGL コンテキストロスト対策(スリープ復帰/GPU リセット)。既定では一度失うと復帰せず、
    // 描画が止まり readPixels が透明を返してクリックスルーが全透過に固着し操作不能になる。
    // preventDefault で復帰を許可し、復帰時に描画を再開する(isHit もロスト中はフォールバック)。
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, Math.PI);
    dir.position.set(1, 1, 1);
    this.scene.add(dir);
    this.resize();
  }

  /** キャンバス実寸に合わせて解像度を更新(DPR は 2 で頭打ち=軽量)。 */
  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** VRM モデル(ArrayBuffer)を読み込んでシーンへ。失敗時は例外(呼び出し側が PNG フォールバック)。 */
  async loadModel(bytes: ArrayBuffer): Promise<void> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(bytes, '');
    const vrm = gltf.userData.vrm as VRM;

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);

    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }
    this.scene.add(vrm.scene);
    this.vrm = vrm;
    if (vrm.lookAt) vrm.lookAt.target = this.camera; // 目線は常にこちら(正面固定)

    const head = vrm.humanoid?.getNormalizedBoneNode('head');
    if (head) {
      const p = new THREE.Vector3();
      head.getWorldPosition(p);
      this.headY = p.y;
    }
    this.applyEmotion();
  }

  /** 会話の感情を反映(JSON マップ経由・ハードコードしない)。 */
  setEmotion(emotion: EmotionLabel): void {
    this.emotion = emotion;
    this.applyEmotion();
  }

  /** talking 中フラグ(音声が無い文字応答でも口を動かすための時間ベース口パクに使う)。 */
  setTalking(talking: boolean): void {
    this.talking = talking;
  }

  /** うなずきを1回起こす(task_18 のうなずきの VRM 版)。strength=深さ(1.0=相槌の基準)。 */
  nod(strength = 1): void {
    this.nodStrength = strength;
    this.nodPhase = 1;
  }

  /** 表示パラメータの更新(GUI スライダーから即時反映)。 */
  setDisplay(display: VrmDisplayParams): void {
    this.display = display;
  }

  private applyEmotion(): void {
    const em = this.vrm?.expressionManager;
    if (!em) return;
    const weights = resolveExpressionWeights(this.expressionMap, this.emotion);
    for (const [name, w] of Object.entries(weights)) em.setValue(name, w);
  }

  /**
   * 表示座標(clientX/Y)がキャラのピクセル上か(クリックスルー判定・案A=シルエット精度)。
   * 描画後バッファの 1px alpha を読む。スキンメッシュへのレイキャストは 31k 三角形のスキニング計算で
   * 非常に重く、毎 mousemove だとドラッグがカクつくため、激安の readPixels に置き換えている。
   */
  isHit(clientX: number, clientY: number): boolean {
    if (!this.vrm) return false;
    const rect = this.canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
      return false;
    }
    const gl = this.renderer.getContext();
    // 3D パイプラインが不健全なとき(コンテキストロスト中 / 描画すべきなのに止まっている / 未描画)は
    // readPixels が古い・空バッファを返す。シルエットの代わりにバウンディングボックスで「不透明」と
    // みなし、ウィンドウが全クリックスルーに固着して操作不能になるのを防ぐ(健全時はシルエット精度)。
    if (gl.isContextLost()) return true;
    // 描画が一定時間止まっている/未描画なら readPixels は当てにならない(最小化復帰直後・パイプライン停止)。
    // running は条件にしない: 可視のはずなのに描画が止まっている場合も固着させない(不確かなら不透明側へ)。
    if (this.lastRenderMs === 0 || performance.now() - this.lastRenderMs > 1000) return true;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = Math.floor(((clientX - rect.left) / rect.width) * w);
    // WebGL の描画バッファは左下原点なので Y を反転する。
    const py = Math.floor((1 - (clientY - rect.top) / rect.height) * h);
    if (px < 0 || px >= w || py < 0 || py >= h) return false;
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.hitPixel);
    return this.hitPixel[3] > 8; // alpha>閾値=キャラのピクセル(透明縁・余白は透過)
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta(); // 蓄積をリセット
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** 表示/非表示(非表示は描画を完全停止=常駐コストを 0 に・§3.6)。 */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.start();
    else this.stop();
  }

  /** ドラッグ中フラグ。true の間は描画を止め、ウィンドウ移動の応答性を優先する。 */
  setDragging(dragging: boolean): void {
    this.dragging = dragging;
  }

  /** WebGL コンテキストのロスト/復帰(スリープ復帰・GPU リセット時の固着対策)。 */
  private onContextLost = (e: Event): void => {
    e.preventDefault(); // これが無いとコンテキストは二度と復帰しない
    this.stop();
  };
  private onContextRestored = (): void => {
    // three.js が管理リソースを再アップロードする。可視中ならループを再開して描き直す。
    this.lastRenderMs = 0; // 復帰直後は未描画 → 描くまで isHit はフォールバック
    if (this.visible) this.start();
  };

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.stop();
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }
    this.renderer.dispose();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    const dt = this.clock.getDelta();
    // ドラッグ中は描画を止め、フレームをウィンドウ移動へ譲る(dt は消費して acc を貯めない)。
    if (this.dragging) {
      this.acc = 0;
      return;
    }
    this.acc += dt;
    const cap = 1 / (this.talking || this.mouthOpen > 0.02 ? FPS_TALKING : FPS_IDLE);
    if (this.acc < cap) return;
    // acc が跳ねても過大な delta を渡さない(SpringBone 発散=髪が飛び出すのを防ぐ)。
    const delta = Math.min(this.acc, MAX_FRAME_DELTA);
    this.acc = 0;

    this.updateCamera();
    if (this.vrm) {
      this.updatePose();
      this.updateBlink(delta);
      this.updateNod(delta);
      this.updateLipSync();
      // 物理(SpringBone)はさらに厳しめにクランプして発散を防ぐ。
      this.vrm.update(Math.min(delta, MAX_PHYSICS_DELTA));
    }
    this.renderer.render(this.scene, this.camera);
    this.lastRenderMs = performance.now();
  };

  private updateCamera(): void {
    const pan = this.display.height;
    this.camera.position.set(0, this.headY - 0.08 + pan, this.display.distance);
    this.camera.lookAt(0, this.headY - 0.12 + pan, 0);
  }

  private updatePose(): void {
    const vrm = this.vrm;
    if (!vrm) return;
    const now = performance.now();
    const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
    if (chest) chest.rotation.x = Math.sin(now / 1400) * 0.02; // 呼吸
    const armRad = THREE.MathUtils.degToRad(this.display.armDownDeg);
    const la = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const ra = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
    if (la) la.rotation.z = armRad;
    if (ra) ra.rotation.z = -armRad;
    vrm.scene.rotation.y = THREE.MathUtils.degToRad(this.display.yawDeg); // 体の向き
  }

  private updateBlink(delta: number): void {
    const em = this.vrm?.expressionManager;
    if (!em) return;
    if (this.blinkPhase > 0) {
      this.blinkPhase -= delta * 6;
      const w = Math.max(0, Math.sin(Math.min(1, 1 - this.blinkPhase) * Math.PI));
      em.setValue('blink', w);
      if (this.blinkPhase <= 0) em.setValue('blink', 0);
    } else {
      this.blinkT += delta;
      if (this.blinkT > 3.5 + Math.random() * 2) {
        this.blinkT = 0;
        this.blinkPhase = 1;
      }
    }
  }

  private updateNod(delta: number): void {
    const vrm = this.vrm;
    if (!vrm) return;
    const neck = vrm.humanoid?.getNormalizedBoneNode('neck') ?? vrm.humanoid?.getNormalizedBoneNode('head');
    if (!neck) return;
    // 代入で 0→下→0 の一往復(加算は累積して首が下がり続けるので不可)。終了後は中立(0)へ戻す。
    if (this.nodPhase > 0) {
      // 減衰係数 2 = 一往復 約0.5秒(3=約0.33秒 から 1.5倍ゆっくり・「ピョコン」回避・2026-06-12 ユーザー)。
      this.nodPhase = Math.max(0, this.nodPhase - delta * 2);
      neck.rotation.x = Math.sin((1 - this.nodPhase) * Math.PI) * 0.25 * this.nodStrength;
    } else {
      neck.rotation.x = 0;
    }
  }

  private updateLipSync(): void {
    const em = this.vrm?.expressionManager;
    if (!em) return;
    // 音声振幅だけで口を開閉する。音声が止まれば amp=0 → 自然に閉じる(話し終わりの開きっぱなし防止)。
    // 振幅は audio-player 側でゲイン済み(0〜1)。開きすぎないよう上限で抑える。
    const amp = this.amplitudeProvider();
    const target = Math.min(MAX_MOUTH_OPEN, amp);
    this.mouthOpen += (target - this.mouthOpen) * MOUTH_SMOOTH;
    if (this.mouthOpen < MOUTH_CLOSE_EPS) this.mouthOpen = 0; // 微小値は完全に閉じる
    for (const v of VISEMES) em.setValue(v, v === VISEME_AA ? this.mouthOpen : 0);
  }
}

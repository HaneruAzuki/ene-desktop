import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRMLoaderPlugin,
  VRMUtils,
  VRMLookAtBoneApplier,
  VRMLookAtExpressionApplier,
  type VRM,
} from '@pixiv/three-vrm';
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

/**
 * あくび(長時間傾聴の情緒ビート・Phase4・docs/listening-mode-design.md §8)。
 * カスタム表情を持たないモデルでも、既存プリセットの合成=口(aa)開閉＋目(blink)細め＋首反らしで出す。
 * あくび中は自動まばたき/リップシンク/うなずきを止め、口・目・首をあくびに譲る。
 */
// poser(scripts/yawn-poser.html)で実機調整した値(2026-06-13)。
const YAWN_OPEN_S = 0.5; // 開くまで
const YAWN_HOLD_S = 0.6; // ピーク保持
const YAWN_CLOSE_S = 0.45; // 閉じるまで
const YAWN_SQUINT = 0.4; // あくびの目の細め(blink 重み・1=完全閉)
const YAWN_HEAD_BACK = 0.13; // 頭を後ろへ反らす最大量(rad・「伸び」の表現)

// 傾聴モードの姿勢=少し首をかしげる(neck.z=roll)。nod(neck.x)とは軸が別なので共存する。
const LISTENING_HEAD_TILT = 0.13; // 首かしげの最大角(rad・~7.5°)。実機で要調整(増減/符号で左右)。
const LISTENING_TILT_LERP = 3; // 入退室の補間速度(大きいほど速い・約0.3秒で入る/戻る)。

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

/**
 * 目線(lookAt)の可動域クランプ＝白目防止(2026-06-14)。
 * 体が後ろを向く(離席/アイドル)間も瞳はカメラ(常に正面中央)を追うため、振り向き中に頭が大きく傾いた
 * 瞬間に眼球が回りすぎて白目になる。three-vrm の rangeMap.outputScale(眼球の最大回転=ボーン式は度/
 * 表情式はウェイト)を上限で抑え、「白目にならない範囲で」カメラを追わせる(map は outputScale で飽和する
 * ので、頭が真後ろでも眼球はこの上限を超えない)。正面時は瞳ほぼ中央なので追従の損失は小さい。
 * いずれも実機で要調整: 白目が残るなら下げる / 3/4 ビューで目が合わないなら上げる(白目の手前まで)。
 */
const GAZE_MAX_BONE_DEG = 14; // ボーン式の眼球最大回転角(度)
const GAZE_MAX_EXPR_WEIGHT = 0.6; // 表情式の目線ウェイト上限(1.0=白目になりやすい)

/**
 * 準備中(起動ウォーム中)の「大きな後ろ向きの頭が下から覗く」姿勢(2026-06-14)。ready で 0 へ戻り起き上がる。
 * 3要素を peek 量(0〜1)で駆動: ①注視点を上げ被写体を下げる(PAN=頭が下端へ) ②カメラを寄せる(ZOOM=頭が大きく)
 *   ③体を後ろへ向ける(updatePose=後ろ頭を見せる)。
 * すべて実機で要調整。⚠ PAN と ZOOM は相互作用: 寄せる(ZOOM大)ほど画角が狭く、同じ PAN でも頭が下へ行く
 *   =寄せたら PAN は控えめに(上げすぎると頭が画面外へ落ちる)。display.distance(既定0.55)基準。 */
const PEEK_CAMERA_PAN = 0.2; // 覗きの深さ(被写体を下げる量・大きいほど頭が下=上げすぎ注意)
const PEEK_CAMERA_ZOOM = 0.25; // 覗き時にカメラを寄せる量(distance から引く・大きいほど頭が大きく映る)
const PEEK_MIN_DISTANCE = 0.2; // 寄せすぎ防止の下限(これより近づけない)
const PEEK_LERP = 2.6; // 覗き↔通常の補間速度(大きいほど速く起き上がる)

export interface VrmRendererOptions {
  canvas: HTMLCanvasElement;
  expressionMap: VrmExpressionMap;
  display: VrmDisplayParams;
  /** 再生中の音声振幅(0〜1)。毎フレーム読んで口の開きを駆動する(振幅ドリブン・B-05)。 */
  amplitudeProvider: () => number;
  /** 生成時の覗き状態(準備中=true で頭だけ覗く姿勢から始める)。 */
  peek?: boolean;
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
  private yawnT = -1; // あくび進行(秒・<0=非あくび)
  // あくびの全調整パラメータ(秒/重み/度)。upper/lower/hand=口元へ添える右手の各ボーン回転(度)。
  // リグ依存=scripts/yawn-poser.html(ブラウザ単体)で調整→ここの既定へ焼く。
  private yawn = {
    open: YAWN_OPEN_S,
    hold: YAWN_HOLD_S,
    close: YAWN_CLOSE_S,
    squint: YAWN_SQUINT,
    headBack: YAWN_HEAD_BACK,
    upper: { x: -51, y: 56, z: 96 }, // 右上腕(poser実機調整 2026-06-13)
    lower: { x: 21, y: 130, z: -38 }, // 右前腕(肘の曲げ)
    hand: { x: -56, y: -4, z: 6 }, // 右手の向き
  };
  // 傾聴中の首かしげ。入退室で target 0↔1、現在値を毎フレーム lerp して neck.z に適用。
  private listeningTiltTarget = 0;
  private listeningTilt = 0;
  private acc = 0; // 30fps cap 用の時間アキュムレータ
  private rafId: number | null = null;
  private running = false;
  private dragging = false; // ドラッグ中は描画を止めてウィンドウ移動を優先
  private visible = true; // 可視状態(コンテキスト復帰時に可視中だけ描画を再開)
  private lastRenderMs = 0; // 最後に描画した時刻(クリックスルー固着のウォッチドッグ用)
  private away = false; // 離席中(後ろを向く・UI改修 段階5)
  private awayRot = 0; // 現在の回頭角(離席のゆっくり回頭・target へ一定速度で近づける)
  private peek = 0; // 現在の覗き量(0=通常, 1=頭だけ覗く・準備中)
  private peekTarget = 0; // 覗きの目標(準備中=1 / ready=0)
  private springResetPending = false; // ロード直後の1フレーム目に SpringBone を現ポーズで rest 化(初期の毛跳ね対策)

  constructor(opts: VrmRendererOptions) {
    this.canvas = opts.canvas;
    this.expressionMap = opts.expressionMap;
    this.display = opts.display;
    this.amplitudeProvider = opts.amplitudeProvider;
    this.peek = this.peekTarget = opts.peek ? 1 : 0; // 準備中なら最初から頭だけ覗く姿勢

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
    this.clampGazeRange(); // 眼球の可動域を白目にならない上限へ(振り向き中の白目防止)

    const head = vrm.humanoid?.getNormalizedBoneNode('head');
    if (head) {
      const p = new THREE.Vector3();
      head.getWorldPosition(p);
      this.headY = p.y;
    }
    this.applyEmotion();
    this.springResetPending = true; // 初回ポーズ確定後に SpringBone を rest 化(初期の毛跳ね防止)
  }

  /**
   * 目線の可動域を「白目にならない上限」でクランプする(白目防止・2026-06-14)。
   * rangeMap.outputScale(眼球の最大回転=ボーン式は度/表情式はウェイト)を上限で抑える。各軸を独立に
   * min するので、上限内ではカメラ方向への追従(向き)は保たれ、上限を超える分(振り向きの極端な角度)だけが
   * 抑えられる。lookAt を持たないモデルや想定外の applier 型では何もしない(描画を止めない)。
   */
  private clampGazeRange(): void {
    const applier = this.vrm?.lookAt?.applier;
    if (!applier) return;
    let cap: number;
    if (applier instanceof VRMLookAtBoneApplier) cap = GAZE_MAX_BONE_DEG;
    else if (applier instanceof VRMLookAtExpressionApplier) cap = GAZE_MAX_EXPR_WEIGHT;
    else return;
    for (const m of [
      applier.rangeMapHorizontalInner,
      applier.rangeMapHorizontalOuter,
      applier.rangeMapVerticalDown,
      applier.rangeMapVerticalUp,
    ]) {
      if (m) m.outputScale = Math.min(m.outputScale, cap);
    }
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

  /** あくびを1回起こす(長時間傾聴の情緒ビート・Phase4・main の onYawn から駆動)。 */
  playYawn(): void {
    this.yawnT = 0;
  }

  /** 傾聴モードの出入り(main の onListeningChange→ene:listening から駆動)。少し首をかしげる/戻す。 */
  setListening(on: boolean): void {
    this.listeningTiltTarget = on ? 1 : 0;
  }

  /** 表示パラメータの更新(GUI スライダーから即時反映)。 */
  setDisplay(display: VrmDisplayParams): void {
    this.display = display;
  }

  /** 離席の切替(UI改修 段階5)。true で真後ろ(絶対180°)を向く(近い側へ短く回頭・updatePose 参照)。 */
  setAway(away: boolean): void {
    this.away = away;
  }

  /** 準備中の「頭だけ下から覗く」姿勢の出入り(起動ウォーム中=true / ready=false で通常へ起き上がる)。 */
  setPeek(on: boolean): void {
    this.peekTarget = on ? 1 : 0;
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

    this.updateCamera(delta);
    if (this.vrm) {
      this.updatePose(delta);
      // あくび中は口・目・首をあくびが占有(自動まばたき/リップシンク/うなずきは止める)。
      const yawning = this.updateYawn(delta);
      if (!yawning) {
        this.updateBlink(delta);
        this.updateNod(delta);
        this.updateLipSync();
      }
      this.updateListeningPose(delta); // 傾聴の首かしげ(neck.z=軸別で nod/あくびと共存)
      // ロード後の最初の1回: 確定したポーズ(腕下げ・準備中の後ろ向き等)で SpringBone を rest 化する。
      // bind ポーズから初回ポーズへ一気に動いた反動で毛が跳ね上がる(初期発散)のを防ぐ。
      if (this.springResetPending) {
        this.vrm.scene.updateMatrixWorld(true);
        this.vrm.springBoneManager?.reset();
        this.springResetPending = false;
      }
      // 物理(SpringBone)はさらに厳しめにクランプして発散を防ぐ。
      this.vrm.update(Math.min(delta, MAX_PHYSICS_DELTA));
    }
    this.renderer.render(this.scene, this.camera);
    this.lastRenderMs = performance.now();
  };

  private updateCamera(delta: number): void {
    // 覗き量を目標へ補間(ready で 1→0=頭だけ→通常へすっと起き上がる)。
    this.peek += (this.peekTarget - this.peek) * Math.min(1, delta * PEEK_LERP);
    // 注視点(と視点)を上げると被写体が下がる=頭だけ下端に残る。pan は覗き量ぶん上乗せ。
    const pan = this.display.height + this.peek * PEEK_CAMERA_PAN;
    // 覗き時はカメラを寄せて頭を大きく見せる(distance を引く・下限でクランプ)。
    const dist = Math.max(PEEK_MIN_DISTANCE, this.display.distance - this.peek * PEEK_CAMERA_ZOOM);
    this.camera.position.set(0, this.headY - 0.08 + pan, dist);
    this.camera.lookAt(0, this.headY - 0.12 + pan, 0);
  }

  private updatePose(delta: number): void {
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
    // 体の向き。基準は display.yawDeg。後ろ向きは「真後ろ(絶対180°)」=base からの差分で表す。
    const base = THREE.MathUtils.degToRad(this.display.yawDeg);
    const backTarget = (base >= 0 ? Math.PI : -Math.PI) - base; // base + backTarget = ±π(真後ろ)
    if (this.peek > 0.001) {
      // 準備中: peek 量で後ろを向く(peek=1→真後ろ / 0→正面)。起き上がり(peek 減衰)と同期して正面へ戻る。
      //   初期 peek=1 なので最初のフレームから後ろ向き(回頭アニメ無し)。away の蓄積はリセット。
      vrm.scene.rotation.y = base + this.peek * backTarget;
      this.awayRot = 0;
    } else {
      // 通常/離席: 一定速度でゆっくり回頭(UI改修 段階5/段階6)。真後ろの符号側へ短く回る。
      const target = this.away ? backTarget : 0;
      const step = (Math.PI / 0.7) * delta;
      if (this.awayRot < target) this.awayRot = Math.min(target, this.awayRot + step);
      else if (this.awayRot > target) this.awayRot = Math.max(target, this.awayRot - step);
      vrm.scene.rotation.y = base + this.awayRot;
    }
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

  /** あくびの envelope(0→1→0)を進行時刻 t(秒)から求める。 */
  private yawnEnvelope(t: number): number {
    const { open, hold, close } = this.yawn;
    if (t < open) return open > 0 ? t / open : 1;
    if (t < open + hold) return 1;
    return Math.max(0, 1 - (t - open - hold) / Math.max(0.001, close));
  }

  /**
   * envelope e(0=rest, 1=ピーク)で口(aa)・目(blink)・首・口元へ添える手を一括適用する。
   * 口は talking より大きく開けたいので MAX_MOUTH_OPEN を通さず直接 aa を駆動する。
   */
  private applyYawnPose(e: number): void {
    const em = this.vrm?.expressionManager;
    if (em) {
      em.setValue('aa', e);
      em.setValue('blink', e * this.yawn.squint); // 開くほど目を細める
    }
    // 首を後ろへ(neck は updateNod と共有=あくび中は nod を止める)。
    const neck = this.vrm?.humanoid?.getNormalizedBoneNode('neck');
    if (neck) neck.rotation.x = -this.yawn.headBack * e;
    this.setYawnArm(e);
  }

  /**
   * あくびの毎フレーム更新。進行中は true を返し、
   * 呼び出し側は updateBlink/updateLipSync/updateNod を止めて口・目・首・手をあくびに譲る。
   * ポーズ値(this.yawn)は scripts/yawn-poser.html で調整して焼く。
   */
  private updateYawn(delta: number): boolean {
    if (!this.vrm || this.yawnT < 0) return false;
    this.yawnT += delta;
    const total = this.yawn.open + this.yawn.hold + this.yawn.close;
    if (this.yawnT >= total) {
      this.yawnT = -1;
      this.applyYawnPose(0); // 口・目・首・手を rest へ戻す
      return false;
    }
    this.applyYawnPose(this.yawnEnvelope(this.yawnT));
    return true;
  }

  /**
   * あくびで口元へ添える右手のポーズ。envelope e(0=rest, 1=口元)で rest↔target を補間する。
   * upperArm/lowerArm/hand を代入(累積させない・gotcha)。z は updatePose の rest(-armDownDeg)から target へ補間。
   * 角度(this.yawn.upper/lower/hand)はリグ依存=実機のスライダーで調整→既定へ焼く。
   * updatePose は毎フレーム upperArm.z=rest を入れるが、本メソッドは updatePose の後に走るので上書きできる。
   */
  private setYawnArm(e: number): void {
    const hum = this.vrm?.humanoid;
    if (!hum) return;
    const r = THREE.MathUtils.degToRad;
    const d = this.yawn;
    const restZ = -r(this.display.armDownDeg);
    const up = hum.getNormalizedBoneNode('rightUpperArm');
    const lo = hum.getNormalizedBoneNode('rightLowerArm');
    const ha = hum.getNormalizedBoneNode('rightHand');
    if (up) up.rotation.set(r(d.upper.x) * e, r(d.upper.y) * e, restZ + (r(d.upper.z) - restZ) * e);
    if (lo) lo.rotation.set(r(d.lower.x) * e, r(d.lower.y) * e, r(d.lower.z) * e);
    if (ha) ha.rotation.set(r(d.hand.x) * e, r(d.hand.y) * e, r(d.hand.z) * e);
  }

  /** 傾聴の首かしげ(neck.z=roll を lerp)。nod は neck.x なので軸が別=共存する。毎フレーム呼ぶ。 */
  private updateListeningPose(delta: number): void {
    const neck =
      this.vrm?.humanoid?.getNormalizedBoneNode('neck') ?? this.vrm?.humanoid?.getNormalizedBoneNode('head');
    if (!neck) return;
    this.listeningTilt +=
      (this.listeningTiltTarget - this.listeningTilt) * Math.min(1, delta * LISTENING_TILT_LERP);
    neck.rotation.z = LISTENING_HEAD_TILT * this.listeningTilt;
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

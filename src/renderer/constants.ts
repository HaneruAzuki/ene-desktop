// Renderer の定数(設計書 §8.2 / §8.5)。将来調整できるよう一元管理する。

// マウス操作判別(§8.2)
export const DRAG_THRESHOLD_PX = 5; // この距離以上でドラッグ判定
export const CLICK_MAX_DURATION_MS = 500; // この時間未満でクリック判定

// 応答吹き出し(§8.5)
export const BUBBLE_AUTO_DISMISS_MS = 30_000; // 30秒で自動消滅
export const BUBBLE_MAX_WIDTH_PX = 240;
export const BUBBLE_MAX_HEIGHT_PX = 400;

// アニメ(task_13・F-ANIM-12: フレーム間隔等の数値は定数で一元管理)
export const MOUTH_FLAP_MS = 150; // talking: 口開閉の切替間隔(1トグル=ほぼ1文字)
export const IDLE_SWAY_MS = 4000; // idle: 呼吸(CSS transform)の周期
export const SOFA_AFTER_IDLE_MS = 60_000; // この時間 idle が続くと寝そべりへ
// 口パクの総時間 ≈ 文字数 × MOUTH_FLAP_MS(「一文字1口パク」)。話し終えたら idle に戻す。
export const TALKING_MIN_MS = 400; // 最短(短い相槌でも少し口が動く)
export const TALKING_MAX_MS = 6000; // 最長(長文でも口パクが延々続かない上限)
// まばたきは 0.2 では実装しない(フルフレーム方式では枚数が増えるため後回し)

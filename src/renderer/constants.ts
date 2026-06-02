// Renderer の定数(設計書 §8.2 / §8.5)。将来調整できるよう一元管理する。

// マウス操作判別(§8.2)
export const DRAG_THRESHOLD_PX = 5; // この距離以上でドラッグ判定
export const CLICK_MAX_DURATION_MS = 500; // この時間未満でクリック判定

// 応答吹き出し(§8.5)
export const BUBBLE_AUTO_DISMISS_MS = 30_000; // 30秒で自動消滅
export const BUBBLE_MAX_WIDTH_PX = 240;
export const BUBBLE_MAX_HEIGHT_PX = 400;

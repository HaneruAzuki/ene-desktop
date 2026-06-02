import { DRAG_THRESHOLD_PX, CLICK_MAX_DURATION_MS } from './constants';

// マウス操作判別の純粋ロジック(設計書 §8.2)。UI から切り出して単体テスト可能にする。

export type Gesture = 'drag' | 'click' | 'longpress';

/** 移動距離がドラッグ閾値以上か。 */
export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/**
 * mouseup 時のジェスチャ判定。
 * - 既にドラッグ確定 → 'drag'
 * - 移動が閾値未満で押下時間が短い → 'click'
 * - 移動が閾値未満で押下時間が長い → 'longpress'(誤操作回避で何もしない)
 */
export function classifyGesture(elapsedMs: number, becameDrag: boolean): Gesture {
  if (becameDrag) return 'drag';
  if (elapsedMs < CLICK_MAX_DURATION_MS) return 'click';
  return 'longpress';
}

/** ドラッグ中のウィンドウ左上座標(掴んだ相対位置をカーソル下に保つ)。 */
export function computeWindowTopLeft(
  screenX: number,
  screenY: number,
  grabX: number,
  grabY: number,
): { x: number; y: number } {
  return { x: Math.round(screenX - grabX), y: Math.round(screenY - grabY) };
}

import { describe, it, expect } from 'vitest';
import {
  exceedsDragThreshold,
  classifyGesture,
  computeWindowTopLeft,
} from '../../src/app/renderer/mouse-gesture';

describe('mouse-gesture (設計書 §8.2)', () => {
  it('exceedsDragThreshold は 5px 以上で true', () => {
    expect(exceedsDragThreshold(3, 3)).toBe(false); // hypot ≈ 4.24
    expect(exceedsDragThreshold(4, 4)).toBe(true); // hypot ≈ 5.66
    expect(exceedsDragThreshold(5, 0)).toBe(true);
    expect(exceedsDragThreshold(0, 0)).toBe(false);
  });

  it('classifyGesture: ドラッグ確定なら drag', () => {
    expect(classifyGesture(0, true)).toBe('drag');
    expect(classifyGesture(10_000, true)).toBe('drag');
  });

  it('classifyGesture: 短押しは click、長押しは longpress', () => {
    expect(classifyGesture(100, false)).toBe('click');
    expect(classifyGesture(499, false)).toBe('click');
    expect(classifyGesture(500, false)).toBe('longpress');
    expect(classifyGesture(600, false)).toBe('longpress');
  });

  it('computeWindowTopLeft は掴んだ相対位置を引いた整数座標を返す', () => {
    expect(computeWindowTopLeft(1000, 500, 20, 30)).toEqual({ x: 980, y: 470 });
    expect(computeWindowTopLeft(100.6, 200.4, 0, 0)).toEqual({ x: 101, y: 200 });
  });
});

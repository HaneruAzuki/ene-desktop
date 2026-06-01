import { describe, it, expect, vi } from 'vitest';

// electron をモック(window-position は screen を import するため、純粋関数テストでも必要)。
vi.mock('electron', () => ({
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getAllDisplays: () => [] },
}));

import { calculateDefaultPosition, clampToVisible } from '../../src/main/window-position';

const WIN = { width: 240, height: 320 };

describe('window-position (設計書 §8.1 / §8.3)', () => {
  it('calculateDefaultPosition は作業領域の右下(マージン20)に置く', () => {
    const pos = calculateDefaultPosition({ x: 0, y: 0, width: 1920, height: 1080 }, WIN);
    expect(pos).toEqual({ x: 1920 - 240 - 20, y: 1080 - 320 - 20 });
  });

  it('作業領域オフセット(マルチモニタ左上座標)を考慮する', () => {
    const pos = calculateDefaultPosition({ x: -1920, y: 0, width: 1920, height: 1080 }, WIN);
    expect(pos).toEqual({ x: -1920 + 1920 - 240 - 20, y: 1080 - 320 - 20 });
  });

  it('画面内の位置はそのまま返す', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    expect(clampToVisible({ x: 100, y: 100 }, WIN, displays)).toEqual({ x: 100, y: 100 });
  });

  it('画面外の位置は既定位置へ補正する', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    const r = clampToVisible({ x: 99999, y: 99999 }, WIN, displays);
    expect(r).toEqual({ x: 1920 - 240 - 20, y: 1080 - 320 - 20 });
  });

  it('画面内だが端からはみ出す位置はディスプレイ内にクランプする', () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    const r = clampToVisible({ x: 1900, y: 1070 }, WIN, displays);
    expect(r.x).toBe(1920 - 240);
    expect(r.y).toBe(1080 - 320);
  });

  it('ディスプレイが無い場合は入力をそのまま返す', () => {
    expect(clampToVisible({ x: 5, y: 5 }, WIN, [])).toEqual({ x: 5, y: 5 });
  });
});

import { describe, it, expect } from 'vitest';
import {
  nowLocalIso,
  nowLocalIsoForFilename,
  todayLocalYmd,
} from '../../src/shared/datetime';

describe('datetime (設計書 §5.6)', () => {
  it('nowLocalIso はローカルタイム+TZオフセット形式を返す(UTC ではない)', () => {
    const s = nowLocalIso();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // UTC の "Z" 表記でないこと
    expect(s.endsWith('Z')).toBe(false);
  });

  it('nowLocalIsoForFilename はコロンを "-" に置換し TZ を省略する', () => {
    const s = nowLocalIsoForFilename();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    expect(s.includes(':')).toBe(false);
  });

  it('todayLocalYmd は現在のローカル日付の数値を返す', () => {
    const { year, month, day } = todayLocalYmd();
    const now = new Date();
    expect(year).toBe(now.getFullYear());
    expect(month).toBe(now.getMonth() + 1);
    expect(day).toBe(now.getDate());
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });
});

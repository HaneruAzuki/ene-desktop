import { describe, it, expect } from 'vitest';
import { validateSemantic, validateSemanticPatch } from '../../src/memory/schema-validation';

describe('schema-validation (設計書 §3.3)', () => {
  it('version の既定は 1', () => {
    expect(validateSemantic({}).version).toBe(1);
  });

  it('既存の version を保持する', () => {
    expect(validateSemantic({ version: 2 }).version).toBe(2);
  });

  it('型不一致のコアフィールドは無視する(例外を投げない)', () => {
    const r = validateSemantic({ version: 1, userName: 123, longTermGoals: 'x' });
    expect(r.userName).toBeUndefined();
    expect(r.longTermGoals).toBeUndefined();
  });

  it('正しいコアフィールドは採用する', () => {
    const r = validateSemantic({ version: 1, userName: '太郎', personality: ['几帳面'] });
    expect(r.userName).toBe('太郎');
    expect(r.personality).toEqual(['几帳面']);
  });

  it('extra は正しい値を保持し、不正値のキーを捨てる', () => {
    const r = validateSemantic({
      version: 1,
      extra: { fav: '猫', count: 3, ok: true, tags: ['a', 'b'], bad: { nested: 1 } },
    });
    expect(r.extra).toEqual({ fav: '猫', count: 3, ok: true, tags: ['a', 'b'] });
    expect(r.extra?.bad).toBeUndefined();
  });

  it('validateSemanticPatch は version を含めない', () => {
    const p = validateSemanticPatch({ userName: '太郎' });
    expect(p.userName).toBe('太郎');
    expect((p as Record<string, unknown>).version).toBeUndefined();
  });

  // --- P5: 名前の読み・誕生日スロット ---
  it('userNameReading を採用する(文字列のみ)', () => {
    expect(validateSemanticPatch({ userNameReading: 'ゆうき' }).userNameReading).toBe('ゆうき');
    expect(validateSemanticPatch({ userNameReading: 123 }).userNameReading).toBeUndefined();
  });

  it('userBirthday は月日が範囲内の整数のときだけ採用する', () => {
    expect(validateSemanticPatch({ userBirthday: { month: 6, day: 12 } }).userBirthday).toEqual({ month: 6, day: 12 });
    expect(validateSemanticPatch({ userBirthday: { month: 6, day: 12, year: 1994 } }).userBirthday).toEqual({
      month: 6,
      day: 12,
      year: 1994,
    });
  });

  it('userBirthday の範囲外・型不一致は無視する', () => {
    expect(validateSemanticPatch({ userBirthday: { month: 13, day: 1 } }).userBirthday).toBeUndefined();
    expect(validateSemanticPatch({ userBirthday: { month: 6, day: 40 } }).userBirthday).toBeUndefined();
    expect(validateSemanticPatch({ userBirthday: { month: '6', day: 12 } }).userBirthday).toBeUndefined();
    expect(validateSemanticPatch({ userBirthday: 'June' }).userBirthday).toBeUndefined();
  });
});

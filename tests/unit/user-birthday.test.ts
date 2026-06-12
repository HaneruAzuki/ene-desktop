import { describe, it, expect } from 'vitest';
import { isUserBirthdayToday } from '../../src/memory/user-birthday';
import type { ActiveCharacter } from '../../src/shared/types/character';

// P5: 相手(ユーザー)の誕生日判定(キャラ誕生日 birthday-checker の鏡像)。

const baseActive: ActiveCharacter = {
  version: 1,
  characterId: 'ene',
  selectedAt: '2026-01-01T00:00:00+09:00',
  birthdayHistory: [],
  firstLaunchCompleted: true,
};

const today = { year: 2026, month: 6, day: 12 };

describe('isUserBirthdayToday (P5)', () => {
  it('誕生日未設定なら false', () => {
    expect(isUserBirthdayToday(undefined, baseActive, today)).toBe(false);
  });
  it('今日が誕生日で未祝いなら true', () => {
    expect(isUserBirthdayToday({ month: 6, day: 12 }, baseActive, today)).toBe(true);
  });
  it('別の日なら false', () => {
    expect(isUserBirthdayToday({ month: 8, day: 11 }, baseActive, today)).toBe(false);
  });
  it('今年すでに祝っていれば false(当日の繰り返しを防ぐ)', () => {
    const active: ActiveCharacter = {
      ...baseActive,
      userBirthdayHistory: [{ year: 2026, celebrated: true }],
    };
    expect(isUserBirthdayToday({ month: 6, day: 12 }, active, today)).toBe(false);
  });
  it('昨年祝っていても、今年の誕生日はまた祝える', () => {
    const active: ActiveCharacter = {
      ...baseActive,
      userBirthdayHistory: [{ year: 2025, celebrated: true }],
    };
    expect(isUserBirthdayToday({ month: 6, day: 12 }, active, today)).toBe(true);
  });
});

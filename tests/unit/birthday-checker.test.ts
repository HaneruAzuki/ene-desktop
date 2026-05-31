import { describe, it, expect } from 'vitest';
import { checkBirthday } from '../../src/character/birthday-checker';
import type { CharacterIdentity, ActiveCharacter } from '../../src/shared/types/character';

function makeIdentity(birthday?: { month: number; day: number }): CharacterIdentity {
  return {
    characterId: 'ene',
    name: 'ENE',
    ageAppearance: '少女',
    gender: 'female',
    birthday,
    personality: { core: '', tone: '', firstPerson: '私', speechEndings: [] },
    selfRecognition: { callsSelf: 'ENE', neverCallsSelf: ['AI'], aiQuestionHandling: '' },
  };
}

function makeActive(history: ActiveCharacter['birthdayHistory'] = []): ActiveCharacter {
  return {
    version: 1,
    characterId: 'ene',
    selectedAt: '2026-01-01T00:00:00+09:00',
    birthdayHistory: history,
    firstLaunchCompleted: true,
  };
}

describe('birthday-checker (設計書 §3.1)', () => {
  it('誕生日未設定なら null', () => {
    expect(checkBirthday(makeIdentity(undefined), makeActive(), { year: 2026, month: 8, day: 15 })).toBeNull();
  });

  it('当日は "today"', () => {
    expect(
      checkBirthday(makeIdentity({ month: 8, day: 15 }), makeActive(), { year: 2026, month: 8, day: 15 }),
    ).toBe('today');
  });

  it('誕生日を過ぎて未祝福なら "forgotten"', () => {
    expect(
      checkBirthday(makeIdentity({ month: 8, day: 15 }), makeActive(), { year: 2026, month: 8, day: 16 }),
    ).toBe('forgotten');
  });

  it('過ぎていても祝福済みなら null', () => {
    expect(
      checkBirthday(
        makeIdentity({ month: 8, day: 15 }),
        makeActive([{ year: 2026, celebrated: true, celebratedAt: '2026-08-15T20:00:00+09:00' }]),
        { year: 2026, month: 8, day: 16 },
      ),
    ).toBeNull();
  });

  it('誕生日より前は null', () => {
    expect(
      checkBirthday(makeIdentity({ month: 8, day: 15 }), makeActive(), { year: 2026, month: 8, day: 14 }),
    ).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { generateGreeting } from '../../src/conversation/greeting';
import { makeCharContext } from './fixtures';
import type { ActiveCharacter, CharacterFewshot, RelationshipFacts } from '../../src/shared/types/character';

// P3: 起動挨拶の棚分けフォールバック(前回会話からの経過で同日/通常/長期不在を出し分ける)。

const tieredFewshot: CharacterFewshot = {
  characterId: 'ene',
  examples: {},
  sameDayGreeting: [{ user: '', assistant: '同日の挨拶' }],
  normalGreeting: [{ user: '', assistant: '通常の挨拶' }],
  longAbsenceGreeting: [{ user: '', assistant: '久しぶりの挨拶' }],
};

/** 今日からの相対日付(ローカル YYYY-MM-DD)。 */
function ymd(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function activeWithLastDate(lastDate: string): ActiveCharacter {
  const relationship: RelationshipFacts = {
    firstMetAt: '2026-01-01T00:00:00+09:00',
    lastConversationDate: lastDate,
    distinctConversationDays: 5,
    totalTurns: 20,
  };
  return {
    version: 1,
    characterId: 'ene',
    selectedAt: '2026-01-01T00:00:00+09:00',
    birthdayHistory: [],
    firstLaunchCompleted: true,
    relationship,
  };
}

describe('generateGreeting tiers (P3)', () => {
  it('同日2回目以降は sameDayGreeting', () => {
    const cc = makeCharContext({ fewshot: tieredFewshot, birthdayHint: null });
    expect(generateGreeting(activeWithLastDate(ymd(0)), cc)).toBe('同日の挨拶');
  });

  it('1〜6日ぶりは normalGreeting', () => {
    const cc = makeCharContext({ fewshot: tieredFewshot, birthdayHint: null });
    expect(generateGreeting(activeWithLastDate(ymd(-3)), cc)).toBe('通常の挨拶');
  });

  it('7日以上ぶりは longAbsenceGreeting', () => {
    const cc = makeCharContext({ fewshot: tieredFewshot, birthdayHint: null });
    expect(generateGreeting(activeWithLastDate(ymd(-10)), cc)).toBe('久しぶりの挨拶');
  });

  it('同日でも sameDayGreeting 未定義なら normalGreeting に倒す', () => {
    const noSameDay: CharacterFewshot = { ...tieredFewshot, sameDayGreeting: undefined };
    const cc = makeCharContext({ fewshot: noSameDay, birthdayHint: null });
    expect(generateGreeting(activeWithLastDate(ymd(0)), cc)).toBe('通常の挨拶');
  });
});

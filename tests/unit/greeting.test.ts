import { describe, it, expect } from 'vitest';
import { generateGreeting } from '../../src/main/greeting';
import { makeCharContext } from './fixtures';
import type { ActiveCharacter, CharacterFewshot } from '../../src/shared/types/character';

function makeActive(over: Partial<ActiveCharacter> = {}): ActiveCharacter {
  return {
    version: 1,
    characterId: 'ene',
    selectedAt: '2026-01-01T00:00:00+09:00',
    birthdayHistory: [],
    firstLaunchCompleted: true,
    ...over,
  };
}

const fewshot: CharacterFewshot = {
  characterId: 'ene',
  examples: {},
  birthdayReactions: {
    celebrated: [{ user: '', assistant: '祝福反応' }],
    forgotten: [{ user: '', assistant: '忘れられ反応' }],
  },
  firstLaunchGreeting: [{ user: '', assistant: 'はじめまして挨拶' }],
  normalGreeting: [{ user: '', assistant: 'おかえり挨拶' }],
};

describe('generateGreeting (設計書 §8.7)', () => {
  it('初回起動は firstLaunchGreeting を返す', () => {
    const cc = makeCharContext({ fewshot });
    expect(generateGreeting(makeActive({ firstLaunchCompleted: false }), cc)).toBe('はじめまして挨拶');
  });

  it('誕生日を忘れられた状態(forgotten)は forgotten 反応を返す', () => {
    const cc = makeCharContext({ fewshot, birthdayHint: 'forgotten' });
    expect(generateGreeting(makeActive(), cc)).toBe('忘れられ反応');
  });

  it('通常起動は normalGreeting を返す', () => {
    const cc = makeCharContext({ fewshot, birthdayHint: null });
    expect(generateGreeting(makeActive(), cc)).toBe('おかえり挨拶');
  });

  it('挨拶定義が無い場合は汎用フォールバック', () => {
    const cc = makeCharContext({ fewshot: { characterId: 'ene', examples: {} }, birthdayHint: null });
    expect(generateGreeting(makeActive(), cc)).toBe('…こんにちは。');
  });
});

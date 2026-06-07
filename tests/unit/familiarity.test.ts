import { describe, it, expect } from 'vitest';
import { deriveFamiliarityStage } from '../../src/memory/familiarity';
import type { RelationshipFacts } from '../../src/shared/types/character';

// 開示ゲーティングの親しさ段階(task_16)。接触の事実3要素・連言・単調。
const DAY = 86_400_000;
const NOW = Date.parse('2026-06-07T12:00:00+09:00');

function facts(daysAgo: number, talkDays: number, turns: number): RelationshipFacts {
  return {
    firstMetAt: new Date(NOW - daysAgo * DAY).toISOString(),
    lastConversationDate: '2026-06-07',
    distinctConversationDays: talkDays,
    totalTurns: turns,
  };
}

describe('familiarity — deriveFamiliarityStage', () => {
  it('事実が無ければ 1(初対面)', () => {
    expect(deriveFamiliarityStage(undefined, NOW)).toBe(1);
  });

  it('段階2の閾値(3日・2会話日・10ターン)で 2', () => {
    expect(deriveFamiliarityStage(facts(3, 2, 10), NOW)).toBe(2);
  });

  it('段階5の閾値(365日・80会話日・800ターン)で 5', () => {
    expect(deriveFamiliarityStage(facts(365, 80, 800), NOW)).toBe(5);
  });

  it('連言: 1要素でも不足なら上がらない(放置1年でも会話してなければ1)', () => {
    // 経過は十分(400日)だが会話日数1・ターン5 → どの段の閾値も満たさず 1
    expect(deriveFamiliarityStage(facts(400, 1, 5), NOW)).toBe(1);
    // 会話量は多いが経過2日 → 段3(30日要)に届かず最大でも段2(3日要)未満なら…
    expect(deriveFamiliarityStage(facts(2, 50, 500), NOW)).toBe(1); // 経過2日<3
  });

  it('単調非減少: 事実が増えれば段は下がらない', () => {
    const a = deriveFamiliarityStage(facts(40, 15, 100), NOW);
    const b = deriveFamiliarityStage(facts(130, 45, 400), NOW);
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it('満たした最大段を返す(中間)', () => {
    // 段3(30/12/80)は満たすが段4(120/40/350)は未達 → 3
    expect(deriveFamiliarityStage(facts(60, 20, 150), NOW)).toBe(3);
  });
});

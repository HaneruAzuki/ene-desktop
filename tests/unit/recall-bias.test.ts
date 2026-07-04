import { describe, it, expect } from 'vitest';
import { matchesInterest, interestBoost } from '../../src/memory/recall/retriever';
import { INTEREST_AFFINITY_WEIGHT } from '../../src/shared/constants';
import type { EpisodicMemory } from '../../src/shared/types/memory';

// 想起の個性化(関心アフィニティ)の純関数シナリオ。
// 「回答が意図どおりか」を方向・符号で固定する(係数の大きさは別途・診断ハーネスで調律)。
function mem(p: Partial<EpisodicMemory>): EpisodicMemory {
  return {
    date: '2026-01-01T00:00:00+09:00',
    topic: 't',
    summary: 's',
    importance: 3,
    category: 'general',
    ...p,
  };
}

describe('関心アフィニティ(自分の関心事に飛びつく)', () => {
  it('関心キーワードが tags/topic/entities に触れれば match する', () => {
    expect(matchesInterest(mem({ tags: ['プログラミング'] }), ['プログラミング'])).toBe(true);
    expect(matchesInterest(mem({ topic: 'ゲーム実況を見た' }), ['ゲーム'])).toBe(true); // 部分一致(順方向)
    expect(matchesInterest(mem({ tags: ['猫'] }), ['猫の動画を見ること'])).toBe(true); // 部分一致(逆方向)
    expect(matchesInterest(mem({ entities: ['Python'] }), ['Python'])).toBe(true);
  });

  it('関心に触れない記憶 / 関心未指定 は match しない', () => {
    expect(matchesInterest(mem({ tags: ['税金'] }), ['プログラミング', '猫'])).toBe(false);
    expect(matchesInterest(mem({ tags: ['プログラミング'] }), [])).toBe(false);
  });

  it('関心に触れる記憶だけ加点(+INTEREST_AFFINITY_WEIGHT)、それ以外は 0', () => {
    expect(interestBoost(mem({ tags: ['プログラミング'] }), ['プログラミング'])).toBe(
      INTEREST_AFFINITY_WEIGHT,
    );
    expect(interestBoost(mem({ tags: ['天気'] }), ['プログラミング'])).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { matchesInterest, interestBoost, cheerupBoost } from '../../src/memory/retriever';
import {
  INTEREST_AFFINITY_WEIGHT,
  CHEERUP_WEIGHT,
  USER_DOWN_THRESHOLD,
} from '../../src/shared/constants';
import type { EpisodicMemory } from '../../src/shared/types/memory';

// 想起の個性化(関心アフィニティ＋元気づけ)の純関数シナリオ。
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

describe('元気づけ(相手が落ち込み気味なら、楽しそうに語った話を引き上げる)', () => {
  const down = USER_DOWN_THRESHOLD - 0.1; // 落ち込み気味
  const calm = 0; // 平常

  it('落ち込み気味のとき、相手が楽しそうに語った(正valence・user)記憶を加点(×valence)', () => {
    expect(cheerupBoost(mem({ valence: 2, provenance: 'user' }), down)).toBe(CHEERUP_WEIGHT * 2);
    expect(cheerupBoost(mem({ valence: 1, provenance: 'user' }), down)).toBe(CHEERUP_WEIGHT * 1);
  });

  it('落ち込んでいないときは加点しない(片方向)', () => {
    expect(cheerupBoost(mem({ valence: 2, provenance: 'user' }), calm)).toBe(0);
  });

  it('負・中立 valence は元気づけに使わない(つらい話を浮かせない)', () => {
    expect(cheerupBoost(mem({ valence: -2, provenance: 'user' }), down)).toBe(0);
    expect(cheerupBoost(mem({ valence: 0, provenance: 'user' }), down)).toBe(0);
  });

  it('canon(トリミ自身の人生)は元気づけに使わない(相手が語った話だけ)', () => {
    expect(cheerupBoost(mem({ valence: 2, provenance: 'self' }), down)).toBe(0);
  });
});

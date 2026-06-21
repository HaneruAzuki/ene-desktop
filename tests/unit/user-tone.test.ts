import { describe, it, expect } from 'vitest';
import { recentUserTone } from '../../src/memory/user-tone';
import type { EpisodicRecord } from '../../src/shared/types/memory';

// 相手のトーン導出(recentUserTone)の検証。純関数・now 注入で決定的。
// 旧 mood の非対称τ・暗転床・蓄積永続は撤去したので、ここでは「直近で寄る/古いと薄れる/canon除外/記憶なし0」を固定する。
const DAY = 86_400_000;
const NOW = Date.parse('2026-06-07T12:00:00+09:00');

function rec(daysAgo: number, valence: number, provenance: 'user' | 'self' = 'user'): EpisodicRecord {
  const d = new Date(NOW - daysAgo * DAY).toISOString();
  return {
    id: `r${daysAgo}_${valence}`,
    memory: { date: d, topic: 't', summary: 's', importance: 3, category: 'general', provenance, valence },
  };
}

describe('recentUserTone(相手の波長)', () => {
  it('記憶が無ければ 0(=落ち込み扱いしない)', () => {
    expect(recentUserTone([], NOW)).toBe(0);
  });

  it('直近の負は負へ、直近の正は正へ寄る(プライアで |値|<2)', () => {
    const neg = recentUserTone([rec(1, -2)], NOW);
    expect(neg).toBeLessThan(0);
    expect(neg).toBeGreaterThan(-2);
    const pos = recentUserTone([rec(1, 2)], NOW);
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeLessThan(2);
  });

  it('新しい記憶ほど強く効く(直近の負が古い正を上回る)', () => {
    expect(recentUserTone([rec(60, 2), rec(1, -2)], NOW)).toBeLessThan(0);
  });

  it('古い記憶は中立プライアで 0 へ薄れる(沈黙=回復)', () => {
    const recent = recentUserTone([rec(1, -2)], NOW);
    const old = recentUserTone([rec(60, -2)], NOW);
    expect(Math.abs(old)).toBeLessThan(Math.abs(recent)); // 古いほど 0 に近い
    expect(recentUserTone([rec(200, -2)], NOW)).toBeCloseTo(0, 1);
  });

  it('canon(provenance:self)はトーンに含めない', () => {
    expect(recentUserTone([rec(1, -2, 'self')], NOW)).toBe(0); // self のみ→対象ゼロ→0
    expect(recentUserTone([rec(1, 2, 'user'), rec(1, -2, 'self')], NOW)).toBeGreaterThan(0); // user のみで算出
  });
});

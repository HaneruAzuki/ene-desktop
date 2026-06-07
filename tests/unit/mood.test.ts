import { describe, it, expect } from 'vitest';
import { deriveMood, clampMood } from '../../src/memory/mood';
import { MOOD_FLOOR } from '../../src/shared/constants';
import type { EpisodicRecord } from '../../src/shared/types/memory';

// 心情導出(task_16)の検証。純関数・now 注入で決定的。
const DAY = 86_400_000;
const NOW = Date.parse('2026-06-07T12:00:00+09:00');

function rec(daysAgo: number, valence: number, provenance: 'user' | 'self' = 'user'): EpisodicRecord {
  const d = new Date(NOW - daysAgo * DAY).toISOString();
  return {
    id: `r${daysAgo}_${valence}`,
    memory: { date: d, topic: 't', summary: 's', importance: 3, category: 'general', provenance, valence },
  };
}

describe('mood — deriveMood', () => {
  it('記憶が無ければ 0(中立)', () => {
    expect(deriveMood([], NOW)).toBe(0);
  });

  it('単一の直近記録は同符号で valence 寄り(プライアで縮約・絶対値は<2)', () => {
    const pos = deriveMood([rec(1, 2)], NOW);
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeLessThan(2);
    const neg = deriveMood([rec(1, -2)], NOW);
    expect(neg).toBeLessThan(0);
    expect(neg).toBeGreaterThan(-2);
  });

  it('直近の負の記憶が積もるほど mood は強く負へ(蓄積=永続)', () => {
    const one = deriveMood([rec(1, -2)], NOW);
    const many = deriveMood([rec(1, -2), rec(2, -2), rec(3, -2), rec(0, -2)], NOW);
    expect(many).toBeLessThan(one); // 件数が増えるほど負が強まる
  });

  it('新しい記憶ほど強く効く(直近の負が古い正を上回る)', () => {
    const mood = deriveMood([rec(60, 2), rec(1, -2)], NOW);
    expect(mood).toBeLessThan(0);
  });

  it('非対称復元力: 同年代の正負では負が速く減衰し mood は正へ寄る', () => {
    // Δ=0 では拮抗(0)、時間が経つと負(τ_neg=7)が正(τ_pos=14)より速く減る。
    expect(deriveMood([rec(0, 2), rec(0, -2)], NOW)).toBeCloseTo(0);
    expect(deriveMood([rec(14, 2), rec(14, -2)], NOW)).toBeGreaterThan(0);
  });

  it('沈黙(古い記憶のみ)なら中立プライアで 0 へ戻る(暗転ロックしない)', () => {
    // 古い負だけでも、時間が経てば 0 付近へ(沈黙=回復)。
    expect(deriveMood([rec(200, -2)], NOW)).toBeCloseTo(0, 1);
    expect(Math.abs(deriveMood([rec(200, 2), rec(200, -2)], NOW))).toBeLessThan(0.1);
  });

  it('canon(provenance:self)は mood を動かさない', () => {
    expect(deriveMood([rec(1, -2, 'self')], NOW)).toBe(0); // self のみ→対象ゼロ→0
    // user と self 混在なら user のみで算出(正の user が効く)
    expect(deriveMood([rec(1, 2, 'user'), rec(1, -2, 'self')], NOW)).toBeGreaterThan(0);
  });
});

describe('mood — clampMood(デレの床)', () => {
  it('MOOD_FLOOR を下回らない', () => {
    expect(clampMood(-3)).toBe(MOOD_FLOOR);
    expect(clampMood(-1)).toBe(-1); // 床より上はそのまま
    expect(clampMood(1.5)).toBe(1.5);
  });
});

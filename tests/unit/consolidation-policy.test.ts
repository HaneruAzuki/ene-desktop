import { describe, it, expect } from 'vitest';
import { planConsolidation } from '../../src/memory/consolidation-policy';
import type { EpisodicRecord } from '../../src/shared/types/memory';

// 忘却の「計画」純粋ロジックの検証(§11.6・段階的縮退)。LLM/IO なし=決定論。

interface RecOpts {
  importance?: number;
  tier?: 'monthly' | 'yearly';
  provenance?: 'user' | 'self';
  category?: string;
}
function rec(id: string, date: string, opts: RecOpts = {}): EpisodicRecord {
  return {
    id,
    memory: {
      date,
      topic: 't',
      summary: 's',
      importance: opts.importance ?? 3,
      category: opts.category ?? (opts.tier ? 'summary' : 'general'),
      ...(opts.provenance ? { provenance: opts.provenance } : {}),
      ...(opts.tier ? { extra: { summaryTier: opts.tier } } : {}),
    },
  };
}

const NOW = { year: 2026, month: 6 };

describe('consolidation-policy (§11.6)', () => {
  it('完了した月は月次計画に入り、importance≤2 のみ削除対象にする', () => {
    const records = [
      rec('2026/general/a', '2026-05-10T10:00:00+09:00', { importance: 1 }),
      rec('2026/general/b', '2026-05-20T10:00:00+09:00', { importance: 3 }),
      rec('2026/general/c', '2026-05-25T10:00:00+09:00', { importance: 2 }),
    ];
    const plan = planConsolidation(records, NOW);
    expect(plan.monthly).toHaveLength(1);
    const m = plan.monthly[0]!;
    expect(m.period).toBe('2026-05');
    expect(m.toSummarize).toHaveLength(3);
    expect(m.toDelete.sort()).toEqual(['2026/general/a', '2026/general/c']); // imp1,2
    expect(plan.yearly).toHaveLength(0);
  });

  it('当月(未完了)は触らない', () => {
    const records = [rec('2026/general/c', '2026-06-05T10:00:00+09:00', { importance: 1 })];
    const plan = planConsolidation(records, NOW);
    expect(plan.monthly).toHaveLength(0);
    expect(plan.yearly).toHaveLength(0);
  });

  it('2年以上前の年は年次計画(月次にしない)・importance≤3 を削除', () => {
    const records = [
      rec('2024/general/x', '2024-03-01T10:00:00+09:00', { importance: 2 }),
      rec('2024/general/y', '2024-07-01T10:00:00+09:00', { importance: 4 }),
    ];
    const plan = planConsolidation(records, NOW);
    expect(plan.monthly).toHaveLength(0); // 年次が扱うため月次にはしない
    expect(plan.yearly).toHaveLength(1);
    const y = plan.yearly[0]!;
    expect(y.year).toBe(2024);
    expect(y.toSummarize).toHaveLength(2);
    expect(y.toDelete).toEqual(['2024/general/x']); // imp2≤3、imp4 は残す
  });

  it('年次は月次サマリを巻き上げて削除する', () => {
    const records = [
      rec('2024/summary/s', '2024-05-15T00:00:00+09:00', { tier: 'monthly', importance: 4 }),
      rec('2024/general/y', '2024-07-01T10:00:00+09:00', { importance: 5 }),
    ];
    const plan = planConsolidation(records, NOW);
    expect(plan.yearly).toHaveLength(1);
    const y = plan.yearly[0]!;
    expect(y.toSummarize).toHaveLength(2); // 月次サマリ＋残存詳細
    expect(y.toDelete).toEqual(['2024/summary/s']); // 月次サマリは削除、imp5 は残す
  });

  it('月次サマリ済みの月は再計画しない(冪等)', () => {
    const records = [
      rec('2026/general/a', '2026-05-10T10:00:00+09:00', { importance: 1 }),
      rec('2026/summary/s', '2026-05-15T00:00:00+09:00', { tier: 'monthly', importance: 4 }),
    ];
    const plan = planConsolidation(records, NOW);
    expect(plan.monthly).toHaveLength(0);
  });

  it('年次サマリ済みの年は再計画しない(冪等)', () => {
    const records = [
      rec('2023/general/x', '2023-03-01T10:00:00+09:00', { importance: 2 }),
      rec('2023/summary/y', '2023-12-31T00:00:00+09:00', { tier: 'yearly', importance: 5 }),
    ];
    const plan = planConsolidation(records, NOW);
    expect(plan.yearly).toHaveLength(0);
  });

  it('canon(provenance:self)は忘却対象外', () => {
    const records = [
      rec('self/1', '2020-01-01T10:00:00+09:00', { importance: 1, provenance: 'self' }),
    ];
    const plan = planConsolidation(records, NOW);
    expect(plan.monthly).toHaveLength(0);
    expect(plan.yearly).toHaveLength(0);
  });

  it('生記録が無い月(サマリのみ)は月次計画を作らない', () => {
    const records = [
      rec('2026/summary/s', '2026-04-15T00:00:00+09:00', { tier: 'monthly', importance: 4 }),
    ];
    const plan = planConsolidation(records, NOW);
    expect(plan.monthly).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { extractMemoryFromConversation } from '../../src/memory/extractor';
import type { ShortTermEntry } from '../../src/shared/types/memory';

const entries: ShortTermEntry[] = [
  { role: 'user', text: '最近よく眠れない', timestamp: '2026-06-01T10:00:00+09:00', extracted: false },
  { role: 'assistant', text: '…ちゃんと寝なさいよ', timestamp: '2026-06-01T10:00:01+09:00', extracted: false },
];

describe('extractor (設計書 §3.3)', () => {
  it('空エントリは {} を返す', async () => {
    const r = await extractMemoryFromConversation([], async () => '{}');
    expect(r).toEqual({});
  });

  it('summary を200文字以内に収める', async () => {
    const long = 'あ'.repeat(500);
    const r = await extractMemoryFromConversation(entries, async () =>
      JSON.stringify({
        episodic: { topic: 't', summary: long, tags: [], importance: 3, category: 'general' },
        semanticPatch: null,
      }),
    );
    expect(r.episodic?.summary.length).toBeLessThanOrEqual(200);
  });

  it('importance を1〜5の整数にクランプする', async () => {
    const make = (imp: number): (() => Promise<string>) => async () =>
      JSON.stringify({ episodic: { topic: 't', summary: 's', tags: [], importance: imp, category: 'health' } });
    expect((await extractMemoryFromConversation(entries, make(9))).episodic?.importance).toBe(5);
    expect((await extractMemoryFromConversation(entries, make(0))).episodic?.importance).toBe(1);
    expect((await extractMemoryFromConversation(entries, make(3.7))).episodic?.importance).toBe(4);
  });

  it('コードフェンス付き応答もパースする', async () => {
    const r = await extractMemoryFromConversation(
      entries,
      async () => '```json\n{"episodic":null,"semanticPatch":{"userName":"太郎"}}\n```',
    );
    expect(r.episodic).toBeUndefined();
    expect(r.semanticPatch?.userName).toBe('太郎');
  });

  it('episodic/semanticPatch が null なら空', async () => {
    const r = await extractMemoryFromConversation(
      entries,
      async () => '{"episodic":null,"semanticPatch":null}',
    );
    expect(r.episodic).toBeUndefined();
    expect(r.semanticPatch).toBeUndefined();
  });

  it('importance/category が欠けても既定値で正規化する', async () => {
    const r = await extractMemoryFromConversation(
      entries,
      async () => '{"episodic":{"topic":"t","summary":"s","tags":["睡眠"]}}',
    );
    expect(r.episodic?.importance).toBe(3);
    expect(r.episodic?.category).toBe('general');
    expect(r.episodic?.tags).toEqual(['睡眠']);
  });
});

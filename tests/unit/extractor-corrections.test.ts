import { describe, it, expect, vi } from 'vitest';
import { extractMemoryFromConversation } from '../../src/memory/extractor';
import type { EpisodicRecord, ShortTermEntry } from '../../src/shared/types/memory';

// task_15 で拡張した抽出器(entities 抽出・corrections・relevantMemories 注入)の検証。API は使わない。

const entries: ShortTermEntry[] = [
  { role: 'user', text: '田中さんと喧嘩した', timestamp: '2026-06-01T10:00:00+09:00', extracted: false },
];

describe('extractor v2 — entities / schemaVersion', () => {
  it('entities を配列で取り出し、新規 episodic は schemaVersion=2', async () => {
    const r = await extractMemoryFromConversation(entries, [], async () =>
      JSON.stringify({
        episodic: { topic: '喧嘩', summary: 'ユーザーは田中と喧嘩した', tags: ['喧嘩'], entities: ['田中'], importance: 4, category: 'relationship' },
      }),
    );
    expect(r.episodic?.entities).toEqual(['田中']);
    expect(r.episodic?.schemaVersion).toBe(2);
  });

  it('entities 欠落時は空配列に正規化する', async () => {
    const r = await extractMemoryFromConversation(entries, [], async () =>
      JSON.stringify({ episodic: { topic: 't', summary: 's', importance: 3, category: 'general' } }),
    );
    expect(r.episodic?.entities).toEqual([]);
  });

  it('valence を -2..+2 にクランプし、欠落時は 0(中立)', async () => {
    const make = (v: unknown): (() => Promise<string>) => async () =>
      JSON.stringify({ episodic: { topic: 't', summary: 's', importance: 3, category: 'general', valence: v } });
    expect((await extractMemoryFromConversation(entries, [], make(5))).episodic?.valence).toBe(2);
    expect((await extractMemoryFromConversation(entries, [], make(-9))).episodic?.valence).toBe(-2);
    expect((await extractMemoryFromConversation(entries, [], make(-1))).episodic?.valence).toBe(-1);
    // 欠落
    const r = await extractMemoryFromConversation(entries, [], async () =>
      JSON.stringify({ episodic: { topic: 't', summary: 's', importance: 3, category: 'general' } }),
    );
    expect(r.episodic?.valence).toBe(0);
  });
});

describe('extractor v2 — corrections', () => {
  it('有効な corrections を取り出す', async () => {
    const r = await extractMemoryFromConversation(entries, [], async () =>
      JSON.stringify({
        episodic: null,
        corrections: [
          { targetFile: '2026/relationship/old.json', kind: 'supersede', reason: '事実が変わった' },
          { targetFile: '2026/relationship/b.json', kind: 'refine', newSummary: '詳しい要約' },
        ],
      }),
    );
    expect(r.corrections?.length).toBe(2);
    expect(r.corrections?.[0]?.kind).toBe('supersede');
    expect(r.corrections?.[1]?.newSummary).toBe('詳しい要約');
  });

  it('不正な correction(kind 不正・targetFile 欠落)は捨てる', async () => {
    const r = await extractMemoryFromConversation(entries, [], async () =>
      JSON.stringify({
        corrections: [
          { targetFile: 'a.json', kind: 'delete' }, // 不正な kind
          { kind: 'supersede' }, // targetFile 欠落
          { targetFile: 'ok.json', kind: 'reattribute', newEntities: ['田中一郎'] },
        ],
      }),
    );
    expect(r.corrections?.length).toBe(1);
    expect(r.corrections?.[0]?.targetFile).toBe('ok.json');
    expect(r.corrections?.[0]?.newEntities).toEqual(['田中一郎']);
  });

  it('corrections が無ければ undefined(キーを生やさない)', async () => {
    const r = await extractMemoryFromConversation(entries, [], async () =>
      JSON.stringify({ episodic: null, corrections: [] }),
    );
    expect(r.corrections).toBeUndefined();
  });

  it('relevantMemories を id 付きでプロンプトへ載せる(supersede 検知の前提)', async () => {
    const relevant: EpisodicRecord[] = [
      { id: '2026/relationship/old.json', memory: { date: '2026-01-01T00:00:00+09:00', topic: '鈴木', summary: '鈴木が好き', importance: 4, category: 'relationship' } },
    ];
    const complete = vi.fn(async () => '{}');
    await extractMemoryFromConversation(entries, relevant, complete);

    const userArg = complete.mock.calls[0]?.[0]?.user ?? '';
    expect(userArg).toContain('2026/relationship/old.json');
    expect(userArg).toContain('鈴木が好き');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// ベクトル索引(意味検索)の検証。埋め込みはモック注入(API・実モデル不要)。
const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
}));

import { saveEpisodic } from '../../src/memory/episodic';
import {
  cosineSimilarity,
  searchVectors,
  syncVectorIndex,
  rebuildVectorIndex,
  loadVectorIndex,
} from '../../src/memory/index-vector';
import type { Embedder } from '../../src/memory/embedder';
import type { EpisodicMemory, EpisodicRecord } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return { topic: 't', summary: 's', importance: 3, category: 'general', ...part };
}

// 3軸の決定的フェイク埋め込み: [勉強系, 食べ物系, 人物田中]。
function toVec(t: string): number[] {
  return [
    /勉強|テスト|赤点|成績/.test(t) ? 1 : 0,
    /ラーメン|食べ|ご飯/.test(t) ? 1 : 0,
    /田中/.test(t) ? 1 : 0,
  ];
}
function makeEmbedder(): Embedder {
  return { embed: vi.fn(async (texts: string[]) => texts.map(toVec)) };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-vec-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('index-vector — cosine / search', () => {
  it('cosineSimilarity: 同一=1, 直交=0', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it('searchVectors はクエリに近い順に返す', () => {
    const index = {
      dim: 3,
      entries: [
        { id: 'food.json', summary: 'ラーメン', vector: [0, 1, 0] },
        { id: 'study.json', summary: '勉強', vector: [1, 0, 0] },
      ],
    };
    const ranked = searchVectors([1, 0, 0], index, 2);
    expect(ranked[0]?.id).toBe('study.json');
  });
});

describe('index-vector — sync(増分)', () => {
  it('未登録は埋め込み、未変化は再計算しない', async () => {
    const r1: EpisodicRecord = { id: 'a.json', memory: mem({ date: '2026-01-01T00:00:00+09:00', summary: '勉強の話' }) };
    const embedder = makeEmbedder();

    await syncVectorIndex([r1], embedder);
    expect((embedder.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    // 同じ summary で再 sync → 追加埋め込みは発生しない。
    await syncVectorIndex([r1], embedder);
    expect((embedder.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('summary が変わったら埋め直す', async () => {
    const embedder = makeEmbedder();
    await syncVectorIndex([{ id: 'a.json', memory: mem({ date: '2026-01-01T00:00:00+09:00', summary: '旧' }) }], embedder);
    await syncVectorIndex([{ id: 'a.json', memory: mem({ date: '2026-01-01T00:00:00+09:00', summary: 'ラーメンの話' }) }], embedder);

    const idx = await loadVectorIndex();
    const entry = idx.entries.find((e) => e.id === 'a.json');
    expect(entry?.summary).toBe('ラーメンの話');
    expect(entry?.vector).toEqual([0, 1, 0]); // 食べ物軸
  });
});

describe('index-vector — 再生成(派生キャッシュ)', () => {
  it('vectors.json を削除しても episodic 本体から再生成でき内容が一致する', async () => {
    await saveEpisodic(mem({ date: '2026-02-01T00:00:00+09:00', summary: '勉強したい' }));
    await saveEpisodic(mem({ date: '2026-02-02T00:00:00+09:00', category: 'hobby', summary: 'ラーメン食べたい' }));
    const embedder = makeEmbedder();

    const first = await rebuildVectorIndex(embedder);
    await fs.rm(`${h.memDir}/index/vectors.json`, { force: true });
    const second = await rebuildVectorIndex(embedder);

    expect(second.entries).toEqual(first.entries);
  });
});

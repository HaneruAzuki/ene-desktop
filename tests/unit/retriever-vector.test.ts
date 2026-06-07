import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// 想起エンジンのハイブリッド(語彙＋意味の RRF 合流)と、モデル不在時の語彙フォールバック検証。
// 埋め込みはモック注入(API・実モデル不要)。
const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
  getModelsDir: (): string => `${h.memDir}/models`,
}));

import { saveEpisodic } from '../../src/memory/episodic';
import { retrieve } from '../../src/memory/retriever';
import type { Embedder } from '../../src/memory/embedder';
import type { EpisodicMemory } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return { topic: 't', summary: 's', importance: 3, category: 'general', ...part };
}

// 決定的フェイク埋め込み: [勉強系, 食べ物系, 人物田中]。
function toVec(t: string): number[] {
  return [
    /勉強|テスト|赤点|成績/.test(t) ? 1 : 0,
    /ラーメン|食べ|ご飯/.test(t) ? 1 : 0,
    /田中/.test(t) ? 1 : 0,
  ];
}
const fakeEmbedder: Embedder = { embed: async (texts) => texts.map(toVec) };
const throwingEmbedder: Embedder = {
  embed: async () => {
    throw new Error('model not available');
  },
};

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-rvec-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('retriever — 意味の橋渡し(ベクトル)', () => {
  it('語彙が一致しなくても意味で想起する(「赤点」→「テスト前に勉強」)', async () => {
    // tags は「テスト/勉強」。クエリ「赤点」とは字面が一致しない(語彙では引けない)。
    await saveEpisodic(mem({ date: '2026-02-01T00:00:00+09:00', topic: 'テスト前に遊ぶ', summary: 'テスト前なのに遊んだ。勉強しろと反対された', tags: ['テスト', '勉強'] }));
    await saveEpisodic(mem({ date: '2026-02-02T00:00:00+09:00', topic: 'ラーメンの話', category: 'hobby', summary: 'ラーメンが好き', tags: ['ラーメン'] }));

    const got = await retrieve({ text: '赤点取っちゃった…' }, { embedder: fakeEmbedder });
    // 意味的に近い「勉強/テスト」の記録が上位に来る。
    expect(got[0]?.topic).toBe('テスト前に遊ぶ');
  });
});

describe('retriever — 語彙フォールバック(モデル不在)', () => {
  it('埋め込みが失敗しても語彙(entity)想起は機能する', async () => {
    await saveEpisodic(mem({ date: '2026-03-01T00:00:00+09:00', topic: '田中の話', entities: ['田中'] }));
    const got = await retrieve({ text: '田中さんと会った' }, { embedder: throwingEmbedder });
    expect(got.map((m) => m.topic)).toContain('田中の話');
  });
});

describe('retriever — RRF 合流', () => {
  it('語彙と意味の両方で当たる記録を取りこぼさない', async () => {
    // A: 語彙(tag 勉強)＋意味(勉強軸)の両方で当たる。
    await saveEpisodic(mem({ date: '2026-04-01T00:00:00+09:00', topic: '勉強A', summary: '勉強した', tags: ['勉強'] }));
    // B: 意味(勉強軸)だけ当たる(tag 無し)。
    await saveEpisodic(mem({ date: '2026-04-02T00:00:00+09:00', topic: '成績B', summary: '成績の話', tags: [] }));

    const got = await retrieve({ text: 'テストの成績どうだった?' }, { embedder: fakeEmbedder });
    const topics = got.map((m) => m.topic);
    expect(topics).toContain('勉強A');
    expect(topics).toContain('成績B');
  });
});

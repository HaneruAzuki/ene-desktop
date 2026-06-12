import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// 逆引き索引(entity/keyword)の検証。派生キャッシュ＝JSON から再生成可能であることも確認。
const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/shared/node/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getLifeMemoryPath: (id: string): string => `${h.memDir}/${id}/life-memory.json`,
  getActiveCharacterId: (): string => 'ene',
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
}));

import { saveEpisodic } from '../../src/memory/episodic';
import {
  indexEpisodic,
  loadInvertedIndex,
  rebuildInvertedIndex,
  queryInverted,
} from '../../src/memory/index-inverted';
import type { EpisodicMemory } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return { topic: 't', summary: 's', importance: 3, category: 'general', ...part };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-inv-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('index-inverted (design-revision-memory-v2 §1.3)', () => {
  it('indexEpisodic は entity と tag をキーに ID を登録する', async () => {
    await indexEpisodic('2026/general/a.json', mem({ date: '2026-01-01T00:00:00+09:00', entities: ['田中'], tags: ['喧嘩'] }));
    const idx = await loadInvertedIndex();
    expect(idx.entities['田中']).toContain('2026/general/a.json');
    expect(idx.keywords['喧嘩']).toContain('2026/general/a.json');
  });

  it('queryInverted は entity を部分一致で引く(「田中さんと喧嘩」→「田中」)', async () => {
    await indexEpisodic('a.json', mem({ date: '2026-01-01T00:00:00+09:00', entities: ['田中'] }));
    const ids = await queryInverted('田中さんと喧嘩した');
    expect(ids).toContain('a.json');
  });

  it('queryInverted は渡された entities とも緩く一致する(「田中一郎」→「田中」)', async () => {
    await indexEpisodic('a.json', mem({ date: '2026-01-01T00:00:00+09:00', entities: ['田中'] }));
    const ids = await queryInverted('別の話', ['田中一郎']);
    expect(ids).toContain('a.json');
  });

  it('索引ファイルが無ければ episodic 本体から自己再生成する', async () => {
    await saveEpisodic(mem({ date: '2026-05-01T00:00:00+09:00', entities: ['鈴木'], tags: ['学校'] }));
    // 索引ファイルは未作成。load 時に再生成されるはず。
    const idx = await loadInvertedIndex();
    expect(Object.keys(idx.entities)).toContain('鈴木');
    expect(Object.keys(idx.keywords)).toContain('学校');
  });

  it('索引ファイルを削除しても再生成され、検索結果が一致する(受入: 派生キャッシュ)', async () => {
    const m = mem({ date: '2026-07-01T00:00:00+09:00', entities: ['田中'], tags: ['仕事'] });
    const id = await saveEpisodic(m);
    await indexEpisodic(id, m);
    const before = await queryInverted('田中さん');

    // 派生キャッシュを物理削除 → 次回 load で episodic 本体から再生成される。
    await fs.rm(`${h.memDir}/index/inverted.json`, { force: true });

    const after = await queryInverted('田中さん');
    expect(after).toEqual(before);
    expect(after).toContain(id);
  });

  it('rebuild(全再生成)と incremental(増分)で同じ索引になる', async () => {
    const m1 = mem({ date: '2026-06-01T00:00:00+09:00', entities: ['田中'], tags: ['仕事'] });
    const m2 = mem({ date: '2026-06-02T00:00:00+09:00', category: 'health', entities: ['鈴木'], tags: ['睡眠'] });
    const id1 = await saveEpisodic(m1);
    const id2 = await saveEpisodic(m2);

    // incremental
    await indexEpisodic(id1, m1);
    await indexEpisodic(id2, m2);
    const incremental = await loadInvertedIndex();

    // full rebuild
    const rebuilt = await rebuildInvertedIndex();

    expect(rebuilt).toEqual(incremental);
  });
});

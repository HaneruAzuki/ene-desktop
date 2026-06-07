import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// データモデル v2(ID・マイグレーション・byId 読み書き・supersede 除外)の検証。
const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
}));

import {
  saveEpisodic,
  loadEpisodicById,
  updateEpisodicById,
  loadAllEpisodicFiles,
  searchEpisodic,
  episodicId,
  migrateEpisodic,
} from '../../src/memory/episodic';
import type { EpisodicMemory } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return { topic: 't', summary: 's', importance: 3, category: 'general', ...part };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-epiv2-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('episodic v2 (design-revision-memory-v2)', () => {
  it('episodicId は year/category/ファイル名 の相対パスを返す', () => {
    const id = episodicId(mem({ date: '2026-05-10T17:30:00+09:00', category: 'study' }));
    expect(id).toBe('2026/study/2026-05-10T17-30-00.json');
  });

  it('migrateEpisodic は v1(schemaVersion/tags 欠落)を既定値で補完する(非破壊)', () => {
    // v1 相当の生オブジェクト(新フィールドを持たない)。
    const v1 = { date: '2025-01-01T00:00:00+09:00', topic: 'a', summary: 'b', importance: 2, category: 'work' } as EpisodicMemory;
    const m = migrateEpisodic(v1);
    expect(m.schemaVersion).toBe(1);
    expect(m.tags).toEqual([]);
    expect(m.topic).toBe('a');
  });

  it('saveEpisodic は ID を返し、新規は schemaVersion=2 を付与する', async () => {
    const id = await saveEpisodic(mem({ date: '2026-03-01T09:00:00+09:00', category: 'health' }));
    expect(id).toBe('2026/health/2026-03-01T09-00-00.json');
    const loaded = await loadEpisodicById(id);
    expect(loaded?.schemaVersion).toBe(2);
    expect(loaded?.topic).toBe('t');
  });

  it('旧スキーマ(v1)ファイルを読んでも壊れず既定値で補完される', async () => {
    // schemaVersion/tags/entities を持たない JSON を直接書く。
    const dir = `${h.memDir}/episodic/2025/work`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      `${dir}/2025-01-01T00-00-00.json`,
      JSON.stringify({ date: '2025-01-01T00:00:00+09:00', topic: 'old', summary: 'x', importance: 2, category: 'work' }),
    );
    const all = await loadAllEpisodicFiles();
    expect(all.length).toBe(1);
    expect(all[0]?.memory.schemaVersion).toBe(1);
    expect(all[0]?.memory.tags).toEqual([]);
    expect(all[0]?.id).toBe('2025/work/2025-01-01T00-00-00.json');
  });

  it('updateEpisodicById は patch を非破壊マージする', async () => {
    const id = await saveEpisodic(
      mem({ date: '2026-04-01T00:00:00+09:00', summary: '元の要約', entities: ['田中'] }),
    );
    await updateEpisodicById(id, { summary: '更新後' });
    const m = await loadEpisodicById(id);
    expect(m?.summary).toBe('更新後');
    expect(m?.entities).toEqual(['田中']); // 触っていないフィールドは保持
  });

  it('updateEpisodicById は存在しない ID では何もしない(例外を投げない)', async () => {
    await expect(updateEpisodicById('2099/none/x.json', { summary: 'y' })).resolves.toBeUndefined();
  });

  it('searchEpisodic は supersededBy を持つ記録を除外する(current ビュー)', async () => {
    const oldId = await saveEpisodic(mem({ date: '2026-02-01T00:00:00+09:00', topic: 'old', tags: ['z'] }));
    await saveEpisodic(mem({ date: '2026-02-02T00:00:00+09:00', topic: 'new', tags: ['z'] }));
    await updateEpisodicById(oldId, { supersededBy: '2026/general/2026-02-02T00-00-00.json' });

    const found = await searchEpisodic({ tags: ['z'] });
    expect(found.map((m) => m.topic)).toEqual(['new']);
  });
});

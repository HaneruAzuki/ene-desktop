import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
}));

import { saveEpisodic, searchEpisodic } from '../../src/memory/episodic';
import type { EpisodicMemory } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return {
    topic: 't',
    summary: '',
    tags: [],
    importance: 3,
    category: 'general',
    ...part,
  };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-epi-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('episodic (設計書 §3.3 / §5.2)', () => {
  it('saveEpisodic は year/category 階層に date 由来のファイル名で保存する', async () => {
    await saveEpisodic(
      mem({ date: '2026-05-10T17:30:00+09:00', topic: '健康', tags: ['睡眠'], importance: 4, category: 'health' }),
    );
    const dir = `${h.memDir}/episodic/2026/health`;
    const files = await fs.readdir(dir);
    expect(files).toContain('2026-05-10T17-30-00.json');
  });

  it('searchEpisodic はタグ/カテゴリ/重要度/年でフィルタし importance 降順で返す', async () => {
    await saveEpisodic(mem({ date: '2026-01-01T00:00:00+09:00', topic: 'a', tags: ['x'], importance: 2, category: 'work' }));
    await saveEpisodic(mem({ date: '2026-01-02T00:00:00+09:00', topic: 'b', tags: ['y'], importance: 5, category: 'work' }));
    await saveEpisodic(mem({ date: '2025-01-01T00:00:00+09:00', topic: 'c', tags: ['x'], importance: 3, category: 'health' }));

    expect((await searchEpisodic({ tags: ['x'] })).map((m) => m.topic)).toEqual(['c', 'a']);
    expect((await searchEpisodic({ category: 'work' })).map((m) => m.topic)).toEqual(['b', 'a']);
    expect((await searchEpisodic({ minImportance: 3 })).map((m) => m.topic)).toEqual(['b', 'c']);
    expect((await searchEpisodic({ yearFrom: 2025, yearTo: 2025 })).map((m) => m.topic)).toEqual(['c']);
  });

  it('デフォルト limit は 5', async () => {
    for (let i = 0; i < 7; i++) {
      await saveEpisodic(
        mem({ date: `2026-03-0${i + 1}T00:00:00+09:00`, topic: `t${i}`, tags: ['z'], importance: 1, category: 'general' }),
      );
    }
    expect((await searchEpisodic({ tags: ['z'] })).length).toBe(5);
  });
});

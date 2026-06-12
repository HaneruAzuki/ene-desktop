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

import {
  saveEpisodic,
  loadEpisodicById,
  updateEpisodicById,
} from '../../src/memory/episodic';
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

  it('正当な ID は通常どおり読み書きできる(ガードが正常系を壊さない)', async () => {
    const id = await saveEpisodic(
      mem({ date: '2026-05-10T17:30:00+09:00', topic: '健康', category: 'daily' }),
    );
    expect(id).toBe('2026/daily/2026-05-10T17-30-00.json');
    await updateEpisodicById(id, { summary: '更新' });
    expect((await loadEpisodicById(id))?.summary).toBe('更新');
  });

  it('パストラバーサルする ID(../, ..\\, 絶対パス)は拒否する(脱出防止)', async () => {
    // resolveEpisodicPath は読み書きの両経路で呼ばれるため、いずれの入口でも throw する。
    const traversals = [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      '2026/../../escape.json',
      'C:\\Windows\\system.json',
      '/etc/passwd',
    ];
    for (const bad of traversals) {
      await expect(loadEpisodicById(bad)).rejects.toThrow();
      await expect(updateEpisodicById(bad, { summary: 'x' })).rejects.toThrow();
    }
  });
});

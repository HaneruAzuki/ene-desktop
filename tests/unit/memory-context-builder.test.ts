import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getSemanticPath: (): string => `${h.memDir}/semantic.json`,
  getShortTermPath: (): string => `${h.memDir}/short-term.json`,
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
  getModelsDir: (): string => `${h.memDir}/models`,
  getLifeMemoryPath: (id: string): string => `${h.memDir}/characters/${id}/life-memory.json`,
  getActiveCharacterId: (): string => 'ene',
}));

import { buildMemoryContext } from '../../src/memory/context-builder';
import { updateSemantic } from '../../src/memory/semantic';
import { appendShortTerm } from '../../src/memory/short-term';
import { saveEpisodic } from '../../src/memory/episodic';

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-mctx-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('memory context-builder (設計書 §3.3)', () => {
  it('長期・短期・関連中期の3層を統合する', async () => {
    await updateSemantic({ userName: '太郎' });
    await appendShortTerm({
      role: 'user',
      text: 'hi',
      timestamp: '2026-06-01T10:00:00+09:00',
      extracted: false,
    });
    await saveEpisodic({
      date: '2026-05-10T00:00:00+09:00',
      topic: 't',
      summary: '',
      tags: ['k'],
      importance: 3,
      category: 'general',
    });

    const ctx = await buildMemoryContext({ text: 'k のこと覚えてる?' });
    expect(ctx.semantic.userName).toBe('太郎');
    expect(ctx.shortTerm.length).toBe(1);
    expect(ctx.relevantEpisodic.length).toBe(1);
  });
});

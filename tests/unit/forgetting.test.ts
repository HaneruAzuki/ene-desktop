import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// 忘却 orchestrator の統合検証(要約→サマリ保存→物理削除→state)。LLM はモック。
const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/shared/node/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getConsolidationStatePath: (): string => `${h.memDir}/consolidation-state.json`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
  getLifeMemoryPath: (id: string): string => `${h.memDir}/${id}/life-memory.json`,
  getActiveCharacterId: (): string => 'ene',
}));

import { runForgetting, isForgettingEnabled } from '../../src/memory/forgetting';
import { saveEpisodic, loadEpisodicById, loadAllEpisodicFiles } from '../../src/memory/episodic';
import { getConsolidationState } from '../../src/memory/consolidation-state';
import type { EpisodicMemory } from '../../src/shared/types/memory';
import type { LlmComplete } from '../../src/memory/extractor';

const complete: LlmComplete = async () =>
  '{"summary":"5月のまとめ","topic":"5月","tags":["t"],"entities":["太郎"]}';

function mem(date: string, importance: number): EpisodicMemory {
  return { date, topic: 'x', summary: `s${importance}`, importance, category: 'general' };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-forget-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('forgetting orchestrator (§11.6)', () => {
  it('完了月を月次サマリ化し、importance≤2 を物理削除・≥3 は残す', async () => {
    const lowId = await saveEpisodic(mem('2026-05-10T10:00:00+09:00', 1));
    const highId = await saveEpisodic(mem('2026-05-20T10:00:00+09:00', 3));

    const res = await runForgetting(complete, { year: 2026, month: 6 });

    expect(res.summaries).toBeGreaterThanOrEqual(1);
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    expect(await loadEpisodicById(lowId)).toBeNull(); // 低重要度=削除
    expect(await loadEpisodicById(highId)).not.toBeNull(); // 高重要度=残る

    const all = await loadAllEpisodicFiles();
    const summary = all.find((r) => r.memory.extra?.['summaryTier'] === 'monthly');
    expect(summary).toBeDefined();
    expect(summary!.memory.category).toBe('summary');

    const state = await getConsolidationState();
    expect(state.lastRun).toBeTruthy();
  });

  it('要約に失敗した期間は削除しない(サマリ無しで記憶を失わない)', async () => {
    const lowId = await saveEpisodic(mem('2026-05-10T10:00:00+09:00', 1));
    const failing: LlmComplete = async () => 'not json';

    const res = await runForgetting(failing, { year: 2026, month: 6 });

    expect(res.summaries).toBe(0);
    expect(res.deleted).toBe(0);
    expect(await loadEpisodicById(lowId)).not.toBeNull();
  });

  it('当月(未完了)は触らない', async () => {
    const id = await saveEpisodic(mem('2026-06-05T10:00:00+09:00', 1));
    const res = await runForgetting(complete, { year: 2026, month: 6 });
    expect(res.summaries).toBe(0);
    expect(await loadEpisodicById(id)).not.toBeNull();
  });

  it('暮らしの断片(daily-life)は要約せず直接削除・直近は残す(B-18)', async () => {
    const dl = (date: string): EpisodicMemory => ({
      date, topic: '日々', summary: '平凡な一日', importance: 2, category: 'daily-life', provenance: 'self',
    });
    const oldId = await saveEpisodic(dl('2026-04-10T10:00:00+09:00')); // 2ヶ月前=削除
    const recentId = await saveEpisodic(dl('2026-05-10T10:00:00+09:00')); // 直近=残す

    const res = await runForgetting(complete, { year: 2026, month: 6 });

    expect(await loadEpisodicById(oldId)).toBeNull();
    expect(await loadEpisodicById(recentId)).not.toBeNull();
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    // daily-life は user サマリを作らない(provenance 汚染なし)。
    const all = await loadAllEpisodicFiles();
    expect(all.find((r) => r.memory.extra?.['summaryTier'])).toBeUndefined();
  });

  it('忘却は既定オン・ENE_FORGETTING=0 で無効化できる', () => {
    delete process.env['ENE_FORGETTING'];
    expect(isForgettingEnabled()).toBe(true);
    process.env['ENE_FORGETTING'] = '0';
    expect(isForgettingEnabled()).toBe(false);
    delete process.env['ENE_FORGETTING']; // 後始末(他テストへ影響させない)
  });
});

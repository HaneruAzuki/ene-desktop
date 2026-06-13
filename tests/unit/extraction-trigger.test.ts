import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/shared/node/paths', () => ({
  getShortTermPath: (): string => `${h.memDir}/short-term.json`,
  getSemanticPath: (): string => `${h.memDir}/semantic.json`,
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
  getModelsDir: (): string => `${h.memDir}/models`,
  getLifeMemoryPath: (id: string): string => `${h.memDir}/${id}/life-memory.json`,
  getActiveCharacterId: (): string => 'ene',
}));

import { extractFromShortTerm } from '../../src/memory/extraction-trigger';
import { getShortTerm } from '../../src/memory/short-term';
import { getSemantic } from '../../src/memory/semantic';
import { loadAllEpisodicFiles } from '../../src/memory/episodic';
import { writeJson } from '../../src/shared/node/json-store';
import type { ShortTermEntry } from '../../src/shared/types/memory';

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-trig-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('extraction-trigger (設計書 §3.3)', () => {
  it('未抽出が無ければ complete を呼ばない', async () => {
    const seeded: ShortTermEntry[] = [
      { role: 'user', text: 'x', timestamp: '2026-06-01T10:00:00+09:00', extracted: true },
    ];
    await writeJson(`${h.memDir}/short-term.json`, seeded);
    const complete = vi.fn(async () => '{}');
    await extractFromShortTerm('shutdown', complete);
    expect(complete).not.toHaveBeenCalled();
  });

  it('抽出して episodic/semantic を保存し、エントリを extracted にする', async () => {
    const seeded: ShortTermEntry[] = [
      { role: 'user', text: '最近よく眠れない', timestamp: '2026-06-01T10:00:00+09:00', extracted: false },
      { role: 'assistant', text: '寝なさいよ', timestamp: '2026-06-01T10:00:01+09:00', extracted: false },
    ];
    await writeJson(`${h.memDir}/short-term.json`, seeded);

    const complete = vi.fn(async () =>
      JSON.stringify({
        episodic: { topic: '睡眠', summary: 'ユーザーは睡眠改善に関心', tags: ['睡眠'], importance: 4, category: 'health' },
        semanticPatch: { preferences: { sleep: '改善したい' } },
      }),
    );

    await extractFromShortTerm('shutdown', complete);

    expect(complete).toHaveBeenCalledOnce();
    const eps = await loadAllEpisodicFiles();
    expect(eps.length).toBe(1);
    expect(eps[0]?.memory.topic).toBe('睡眠');
    const sem = await getSemantic();
    expect(sem.preferences?.sleep).toBe('改善したい');
    const st = await getShortTerm();
    expect(st.every((e) => e.extracted)).toBe(true);
  });

  it('主人未確定なら、抽出で初代主人の名前を確定できる(空→設定)', async () => {
    const seeded: ShortTermEntry[] = [
      { role: 'user', text: '私はゆうやです', timestamp: '2026-06-01T10:00:00+09:00', extracted: false },
    ];
    await writeJson(`${h.memDir}/short-term.json`, seeded);
    const complete = vi.fn(async () => JSON.stringify({ semanticPatch: { userName: 'ゆうや' } }));

    await extractFromShortTerm('shutdown', complete);

    expect((await getSemantic()).userName).toBe('ゆうや');
  });

  it('主人確定後は、抽出が別名を出しても主人の名前を上書きしない(硬いロック)', async () => {
    // 既に主人=ゆうや が確定している。
    await writeJson(`${h.memDir}/semantic.json`, { version: 1, userName: 'ゆうや' });
    const seeded: ShortTermEntry[] = [
      { role: 'user', text: 'まりこだけど', timestamp: '2026-06-02T10:00:00+09:00', extracted: false },
    ];
    await writeJson(`${h.memDir}/short-term.json`, seeded);
    // 抽出器が別名 + 好みを返しても、名前はロックされ、名前以外だけ反映される。
    const complete = vi.fn(async () =>
      JSON.stringify({ semanticPatch: { userName: 'まりこ', preferences: { 色: '青' } } }),
    );

    await extractFromShortTerm('shutdown', complete);

    const sem = await getSemantic();
    expect(sem.userName).toBe('ゆうや'); // 主人の名前は不変
    expect(sem.preferences?.色).toBe('青'); // 名前以外は素通し
  });
});

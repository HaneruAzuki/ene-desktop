import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// 記憶の非破壊更新(supersede/refine/reattribute)の全パターン検証。
const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getLifeMemoryPath: (id: string): string => `${h.memDir}/characters/${id}/life-memory.json`,
  getActiveCharacterId: (): string => 'ene',
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
}));

import { saveEpisodic, loadEpisodicById, episodicId } from '../../src/memory/episodic';
import { indexEpisodic, queryInverted } from '../../src/memory/index-inverted';
import { applyCorrections } from '../../src/memory/update';
import type { Correction, EpisodicMemory } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return { topic: 't', summary: 's', importance: 3, category: 'general', ...part };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-upd-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('update — supersede(非破壊)', () => {
  it('旧記録に supersededBy を付与し、物理削除はしない', async () => {
    const oldId = await saveEpisodic(mem({ date: '2026-01-01T00:00:00+09:00', topic: '旧', entities: ['鈴木'] }));
    const newMem = mem({ date: '2026-04-01T00:00:00+09:00', topic: '新', entities: ['鈴木'] });
    const newId = await saveEpisodic(newMem);

    const corrections: Correction[] = [{ targetFile: oldId, kind: 'supersede' }];
    const applied = await applyCorrections(corrections, newId);

    expect(applied).toBe(1);
    const old = await loadEpisodicById(oldId);
    expect(old).not.toBeNull(); // 物理削除されていない
    expect(old?.supersededBy).toBe(newId);
  });

  it('置換先(newRecordId)が無い supersede は適用しない', async () => {
    const oldId = await saveEpisodic(mem({ date: '2026-01-01T00:00:00+09:00', topic: '旧' }));
    const applied = await applyCorrections([{ targetFile: oldId, kind: 'supersede' }]);
    expect(applied).toBe(0);
    const old = await loadEpisodicById(oldId);
    expect(old?.supersededBy).toBeUndefined();
  });
});

describe('update — refine / reattribute', () => {
  it('refine は summary / entities を上書きする', async () => {
    const id = await saveEpisodic(mem({ date: '2026-02-01T00:00:00+09:00', summary: '雑な要約', entities: ['鈴木'] }));
    await applyCorrections([
      { targetFile: id, kind: 'refine', newSummary: '鈴木を友達として好きだった', newEntities: ['鈴木一郎'] },
    ]);
    const m = await loadEpisodicById(id);
    expect(m?.summary).toBe('鈴木を友達として好きだった');
    expect(m?.entities).toEqual(['鈴木一郎']);
  });

  it('reattribute はその1件のみ再帰属し、他の同名記録は変えない', async () => {
    const target = await saveEpisodic(mem({ date: '2026-03-01T00:00:00+09:00', topic: '取り違え', entities: ['田中'] }));
    const other = await saveEpisodic(mem({ date: '2026-03-02T00:00:00+09:00', topic: '別の田中', entities: ['田中'] }));

    await applyCorrections([{ targetFile: target, kind: 'reattribute', newEntities: ['田中一郎'] }]);

    expect((await loadEpisodicById(target))?.entities).toEqual(['田中一郎']);
    expect((await loadEpisodicById(other))?.entities).toEqual(['田中']); // 触らない
  });
});

describe('update — 堅牢性 / 索引整合', () => {
  it('対象が存在しない correction は黙ってスキップする', async () => {
    const applied = await applyCorrections([{ targetFile: '2099/none/x.json', kind: 'refine', newSummary: 'y' }]);
    expect(applied).toBe(0);
  });

  it('reattribute 後に逆引き索引へ新 entity が反映される', async () => {
    const m = mem({ date: '2026-05-01T00:00:00+09:00', entities: ['田中'] });
    const id = await saveEpisodic(m);
    await indexEpisodic(id, m);

    await applyCorrections([{ targetFile: id, kind: 'reattribute', newEntities: ['佐藤'] }]);

    // 索引が作り直され、新 entity「佐藤」で引け、旧「田中」では引けない。
    expect(await queryInverted('佐藤さん')).toContain(id);
    expect(await queryInverted('田中さん')).not.toContain(id);
  });

  it('episodicId で算出した ID を targetFile に使える', async () => {
    const m = mem({ date: '2026-06-01T00:00:00+09:00', summary: '旧' });
    await saveEpisodic(m);
    await applyCorrections([{ targetFile: episodicId(m), kind: 'refine', newSummary: '新' }]);
    expect((await loadEpisodicById(episodicId(m)))?.summary).toBe('新');
  });
});

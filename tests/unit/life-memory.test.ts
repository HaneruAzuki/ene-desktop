import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// 人生記憶 canon ローダ(task_16)。provenance:self 強制・ID=self/N・不在は空。
const h = vi.hoisted(() => ({ dir: '' }));
vi.mock('../../src/shared/node/paths', () => ({
  getActiveCharacterId: (): string => 'ene',
  getLifeMemoryPath: (): string => `${h.dir}/life-memory.json`,
}));

import { loadLifeMemory } from '../../src/memory/life-memory';

beforeEach(async () => {
  h.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-canon-'));
});
afterEach(async () => {
  await fs.rm(h.dir, { recursive: true, force: true });
});

describe('life-memory — loadLifeMemory', () => {
  it('不在(人生記憶を持たない)なら空配列', async () => {
    expect(await loadLifeMemory('ene')).toEqual([]);
  });

  it('canon を provenance:self・ID=self/N で読み込む', async () => {
    await fs.writeFile(
      `${h.dir}/life-memory.json`,
      JSON.stringify([
        { schemaVersion: 2, date: '2018-10-20T16:40:00+09:00', topic: '放置PC', summary: 'PCに出会った', importance: 5, category: 'tech', provenance: 'self', valence: 1, disclosureLevel: 2 },
        { schemaVersion: 2, date: '2020-01-01T00:00:00+09:00', topic: '祖母', summary: '初めての喪失', importance: 4, category: 'family', provenance: 'self', valence: -2, disclosureLevel: 4 },
      ]),
    );
    const recs = await loadLifeMemory('ene');
    expect(recs.length).toBe(2);
    expect(recs[0]?.id).toBe('self/0');
    expect(recs[1]?.id).toBe('self/1');
    expect(recs.every((r) => r.memory.provenance === 'self')).toBe(true);
    expect(recs[1]?.memory.valence).toBe(-2);
    expect(recs[1]?.memory.disclosureLevel).toBe(4);
  });

  it('provenance 欠落でも self に倒す(canon は必ず self)', async () => {
    await fs.writeFile(
      `${h.dir}/life-memory.json`,
      JSON.stringify([{ date: '2019-05-01T00:00:00+09:00', topic: 't', summary: 's', importance: 3, category: 'general' }]),
    );
    const recs = await loadLifeMemory('ene');
    expect(recs[0]?.memory.provenance).toBe('self');
    expect(recs[0]?.memory.valence).toBe(0); // 欠落→中立
    expect(recs[0]?.memory.disclosureLevel).toBe(1); // 欠落→初対面
  });
});

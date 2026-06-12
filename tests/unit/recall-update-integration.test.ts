import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// task_15 ショーケースの結合検証(retriever → extractor → update の persist フロー)。
// LLM は注入モックで代替するため API は使わない。
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

import { saveEpisodic, loadEpisodicById, episodicId } from '../../src/memory/episodic';
import { indexEpisodic, queryInverted } from '../../src/memory/index-inverted';
import { retrieve } from '../../src/memory/retriever';
import { extractFromShortTerm } from '../../src/memory/extraction-trigger';
import { writeJson } from '../../src/shared/node/json-store';
import type { EpisodicMemory, ShortTermEntry } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return { topic: 't', summary: 's', importance: 3, category: 'general', ...part };
}

async function seedConversation(text: string): Promise<void> {
  const st: ShortTermEntry[] = [
    { role: 'user', text, timestamp: '2026-06-01T10:00:00+09:00', extracted: false },
  ];
  await writeJson(`${h.memDir}/short-term.json`, st);
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-int-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('結合: 記憶更新(supersede)ショーケース', () => {
  it('「鈴木は友達としてしか…」で旧「鈴木が好き」を非破壊 supersede し、想起は新しい方だけ返す', async () => {
    const oldMem = mem({
      date: '2026-01-01T00:00:00+09:00',
      topic: '鈴木が好き(旧)',
      summary: '鈴木のことが好きだと言った',
      category: 'relationship',
      entities: ['鈴木'],
      importance: 4,
    });
    const oldId = await saveEpisodic(oldMem);
    await indexEpisodic(oldId, oldMem);

    await seedConversation('実は鈴木のことは友達としてしか見てなかったんだ');

    // 抽出器モック: 新記録 ＋ 旧記録への supersade 指示。targetFile は旧記録の ID。
    const complete = vi.fn(async () =>
      JSON.stringify({
        episodic: {
          topic: '鈴木は友達(新)',
          summary: '鈴木は友達としてしか見ていないと言った',
          tags: [],
          entities: ['鈴木'],
          importance: 3,
          category: 'relationship',
        },
        corrections: [{ targetFile: oldId, kind: 'supersede' }],
      }),
    );

    await extractFromShortTerm('shutdown', complete);

    // 旧記録は物理削除されず supersededBy を持つ(非破壊)。
    const old = await loadEpisodicById(oldId);
    expect(old).not.toBeNull();
    expect(old?.supersededBy).toBeTruthy();

    // 想起は新しい記録だけを返す(古い方は current ビューから除外)。
    const got = await retrieve({ text: '鈴木のことどう思ってる?' });
    expect(got.map((m) => m.topic)).toEqual(['鈴木は友達(新)']);
  });
});

describe('結合: 人物の取り違え(reattribute)ショーケース', () => {
  it('「実は田中じゃなくて佐藤だった」でその1件だけ再帰属する', async () => {
    const target = mem({ date: '2026-02-01T00:00:00+09:00', topic: '取り違え', entities: ['田中'], category: 'relationship' });
    const other = mem({ date: '2026-02-02T00:00:00+09:00', topic: '別の田中の話', entities: ['田中'], category: 'relationship' });
    const targetId = await saveEpisodic(target);
    const otherId = await saveEpisodic(other);
    await indexEpisodic(targetId, target);
    await indexEpisodic(otherId, other);

    await seedConversation('さっきの話、実は田中じゃなくて佐藤だった');

    const complete = vi.fn(async () =>
      JSON.stringify({
        episodic: null,
        corrections: [{ targetFile: targetId, kind: 'reattribute', newEntities: ['佐藤'] }],
      }),
    );

    await extractFromShortTerm('shutdown', complete);

    // 対象だけ佐藤に、もう一方の田中は不変。
    expect((await loadEpisodicById(targetId))?.entities).toEqual(['佐藤']);
    expect((await loadEpisodicById(otherId))?.entities).toEqual(['田中']);

    // 索引も更新され、佐藤で対象を引ける。
    expect(await queryInverted('佐藤さん')).toContain(episodicId(target));
  });
});

describe('結合: 確信が無ければ更新しない(自動上書き禁止)', () => {
  it('corrections が空なら旧記録は一切変わらない', async () => {
    const oldMem = mem({ date: '2026-03-01T00:00:00+09:00', topic: '旧', summary: '元のまま', entities: ['鈴木'] });
    const oldId = await saveEpisodic(oldMem);
    await indexEpisodic(oldId, oldMem);

    await seedConversation('鈴木がどうとか曖昧な話');
    const complete = vi.fn(async () =>
      JSON.stringify({ episodic: null, corrections: [] }),
    );

    await extractFromShortTerm('shutdown', complete);

    const old = await loadEpisodicById(oldId);
    expect(old?.summary).toBe('元のまま');
    expect(old?.supersededBy).toBeUndefined();
  });
});

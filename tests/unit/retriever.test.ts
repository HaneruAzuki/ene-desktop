import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// 想起エンジン(MemoryRetriever)の全パターン検証。API は使わない(純粋ロジック)。
const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
  getModelsDir: (): string => `${h.memDir}/models`,
}));

import { saveEpisodic, updateEpisodicById, episodicId } from '../../src/memory/episodic';
import { retrieve, retrieveRecords } from '../../src/memory/retriever';
import type { EpisodicMemory } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return { topic: 't', summary: 's', importance: 3, category: 'general', ...part };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-ret-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('retriever — 横断想起', () => {
  it('同一人物(entity)を話題が違っても束ねて想起する(田中さん2回ケース)', async () => {
    await saveEpisodic(mem({ date: '2026-01-01T00:00:00+09:00', topic: '会社の同僚', entities: ['田中'], tags: ['仕事'] }));
    await saveEpisodic(mem({ date: '2026-03-01T00:00:00+09:00', topic: 'カラオケ', category: 'hobby', entities: ['田中'], tags: ['趣味'] }));

    const got = await retrieve({ text: '田中さんと喧嘩しちゃった' });
    expect(got.map((m) => m.topic).sort()).toEqual(['カラオケ', '会社の同僚']);
  });

  it('語彙(tag)一致でも想起する(共有キーワードの橋渡し)', async () => {
    await saveEpisodic(mem({ date: '2026-02-01T00:00:00+09:00', topic: '実力テスト前に遊ぶ', tags: ['テスト', '勉強'] }));
    const got = await retrieve({ text: 'またテスト前なのに…' });
    expect(got.map((m) => m.topic)).toContain('実力テスト前に遊ぶ');
  });
});

describe('retriever — supersede 除外(current ビュー)', () => {
  it('supersededBy を持つ古い記録は想起されない', async () => {
    const oldMem = mem({ date: '2026-01-01T00:00:00+09:00', topic: '鈴木が好き(旧)', entities: ['鈴木'], importance: 5 });
    const newMem = mem({ date: '2026-04-01T00:00:00+09:00', topic: '鈴木は友達(新)', entities: ['鈴木'], importance: 3 });
    const oldId = await saveEpisodic(oldMem);
    const newId = await saveEpisodic(newMem);
    await updateEpisodicById(oldId, { supersededBy: newId });

    const got = await retrieve({ text: '鈴木のこと' });
    expect(got.map((m) => m.topic)).toEqual(['鈴木は友達(新)']);
  });
});

describe('retriever — Router 非依存', () => {
  it('ユーザー発言(text)だけで動作する(matchedTopic 等を受け取らない)', async () => {
    await saveEpisodic(mem({ date: '2026-05-01T00:00:00+09:00', topic: 'ラーメン好き', tags: ['ラーメン'] }));
    const got = await retrieve({ text: 'ラーメン食べたい気分' });
    expect(got.map((m) => m.topic)).toContain('ラーメン好き');
  });
});

describe('retriever — 安全網・フィルタ・件数・順序', () => {
  it('関連が薄くても直近×高 importance を少量返す(空にしない)', async () => {
    await saveEpisodic(mem({ date: '2026-06-01T00:00:00+09:00', topic: '重要な出来事', tags: ['仕事'], importance: 5 }));
    const got = await retrieve({ text: '全然関係ない天気の話' });
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[0]?.topic).toBe('重要な出来事');
  });

  it('category は補助フィルタとして候補を絞る', async () => {
    await saveEpisodic(mem({ date: '2026-01-01T00:00:00+09:00', topic: '仕事の田中', category: 'work', entities: ['田中'] }));
    await saveEpisodic(mem({ date: '2026-01-02T00:00:00+09:00', topic: '健康の田中', category: 'health', entities: ['田中'] }));

    const got = await retrieve({ text: '田中', category: 'work' });
    expect(got.map((m) => m.topic)).toEqual(['仕事の田中']);
  });

  it('limit を超えない', async () => {
    for (let i = 0; i < 7; i++) {
      await saveEpisodic(mem({ date: `2026-03-0${i + 1}T00:00:00+09:00`, topic: `t${i}`, entities: ['田中'] }));
    }
    const got = await retrieve({ text: '田中', limit: 3 });
    expect(got.length).toBe(3);
  });

  it('一致候補は importance 降順で並ぶ', async () => {
    await saveEpisodic(mem({ date: '2026-01-01T00:00:00+09:00', topic: '低', entities: ['田中'], importance: 1 }));
    await saveEpisodic(mem({ date: '2026-01-02T00:00:00+09:00', topic: '高', entities: ['田中'], importance: 5 }));
    const got = await retrieve({ text: '田中', limit: 5 });
    expect(got[0]?.topic).toBe('高');
  });

  it('retrieveRecords は ID 付きで返す(更新フローが targetFile に使える)', async () => {
    const m = mem({ date: '2026-07-01T00:00:00+09:00', topic: 'x', entities: ['田中'] });
    await saveEpisodic(m);
    const recs = await retrieveRecords({ text: '田中' });
    expect(recs[0]?.id).toBe(episodicId(m));
    expect(recs[0]?.memory.topic).toBe('x');
  });
});

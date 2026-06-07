import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// 想起エンジンの心(mood バイアス)・開示ゲーティング・canon 統合の検証(task_16)。
// 埋め込みは使わず(モデル不在=語彙のみ)、mood/familiarity/rng は deps 注入で決定化。
const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
  getModelsDir: (): string => `${h.memDir}/models`,
  getLifeMemoryPath: (id: string): string => `${h.memDir}/characters/${id}/life-memory.json`,
  getActiveCharacterId: (): string => 'ene',
}));

import { saveEpisodic } from '../../src/memory/episodic';
import { retrieve } from '../../src/memory/retriever';
import type { EpisodicMemory } from '../../src/shared/types/memory';

function mem(part: Partial<EpisodicMemory> & { date: string }): EpisodicMemory {
  return { topic: 't', summary: 's', importance: 3, category: 'general', ...part };
}

async function writeCanon(entries: EpisodicMemory[]): Promise<void> {
  const dir = `${h.memDir}/characters/ene`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/life-memory.json`, JSON.stringify(entries));
}

// 決定的 RNG(mulberry32)。
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-heart-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('retriever — canon 統合', () => {
  it('人生記憶 canon が想起プールに入り、横断想起で引ける', async () => {
    await saveEpisodic(mem({ date: '2026-01-01T00:00:00+09:00', topic: 'user田中', entities: ['田中'] }));
    await writeCanon([
      mem({ date: '2018-10-20T16:40:00+09:00', topic: 'canon父PC', summary: '父の放置PC', entities: ['父'], tags: ['PC'], provenance: 'self', disclosureLevel: 2 }),
    ]);
    const got = await retrieve({ text: '父のパソコンの話', limit: 5 });
    expect(got.map((m) => m.topic)).toContain('canon父PC');
  });
});

describe('retriever — 開示ゲーティング', () => {
  it('disclosureLevel 超の canon は親しさ不足だと候補に入らない', async () => {
    await writeCanon([
      mem({ date: '2015-01-01T00:00:00+09:00', topic: '恋の核', summary: '初恋の深い話', entities: ['初恋'], tags: ['恋'], provenance: 'self', disclosureLevel: 5 }),
    ]);
    // 初対面(stage 1): Lv5 は出ない
    const early = await retrieve({ text: '初恋の話', limit: 5 }, { familiarityStage: 1 });
    expect(early.map((m) => m.topic)).not.toContain('恋の核');
    // 最も親しい(stage 5): 出る
    const deep = await retrieve({ text: '初恋の話', limit: 5 }, { familiarityStage: 5 });
    expect(deep.map((m) => m.topic)).toContain('恋の核');
  });
});

describe('retriever — 心(mood バイアス)', () => {
  it('負 mood では負 valence 記憶が、正常時より選ばれやすい(統計的)', async () => {
    // 同一 entity・同 importance。P=正(新)/N=負(旧)。limit1 で top を多数サンプリング。
    await saveEpisodic(mem({ date: '2026-02-02T00:00:00+09:00', topic: 'P正', entities: ['田中'], valence: 2 }));
    await saveEpisodic(mem({ date: '2026-02-01T00:00:00+09:00', topic: 'N負', entities: ['田中'], valence: -2 }));

    const countN = async (mood: number): Promise<number> => {
      const rng = mulberry32(12345);
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const got = await retrieve({ text: '田中', limit: 1 }, { mood, rng });
        if (got[0]?.topic === 'N負') n++;
      }
      return n;
    };

    const nNeg = await countN(-1.5); // 暗い気分
    const nZero = await countN(0); // 中立
    expect(nNeg).toBeGreaterThan(nZero); // 負 mood で負記憶が増える
    expect(nNeg).toBeGreaterThan(200); // 強い負 mood ではほぼ負記憶
  });
});

describe('retriever — 安全網は user のみ', () => {
  it('関連が薄い時の補完に canon は使わない(user 記録のみ)', async () => {
    await saveEpisodic(mem({ date: '2026-03-01T00:00:00+09:00', topic: 'user重要', importance: 5 }));
    await writeCanon([
      mem({ date: '2016-01-01T00:00:00+09:00', topic: 'canon鈴木', summary: '鈴木の話', entities: ['鈴木'], provenance: 'self', disclosureLevel: 1 }),
    ]);
    const got = await retrieve({ text: '全然関係ない天気の話', limit: 5 });
    expect(got.map((m) => m.topic)).toContain('user重要');
    expect(got.map((m) => m.topic)).not.toContain('canon鈴木');
  });
});

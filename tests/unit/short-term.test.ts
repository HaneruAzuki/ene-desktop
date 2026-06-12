import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/shared/node/paths', () => ({
  getShortTermPath: (): string => `${h.memDir}/short-term.json`,
}));

import {
  getShortTerm,
  appendShortTerm,
  clearShortTerm,
  getUnextractedEntries,
  markAsExtracted,
} from '../../src/memory/short-term';
import { SHORT_TERM_MAX_ENTRIES } from '../../src/shared/constants';
import type { ShortTermEntry } from '../../src/shared/types/memory';

function entry(i: number): ShortTermEntry {
  return {
    role: 'user',
    text: `m${i}`,
    timestamp: `2026-06-01T10:00:${String(i).padStart(2, '0')}+09:00`,
    extracted: false,
  };
}

const ts = (i: number): string => entry(i).timestamp;

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-st-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('short-term (設計書 §3.3)', () => {
  it('存在しなければ空配列を返す', async () => {
    expect(await getShortTerm()).toEqual([]);
  });

  it('上限以内ではトリムしない', async () => {
    for (let i = 0; i < 5; i++) await appendShortTerm(entry(i));
    expect((await getShortTerm()).length).toBe(5);
  });

  it('上限超過でも未抽出は捨てない(記憶喪失防止・B-01)', async () => {
    // 全件 extracted:false のまま上限を超えても、未抽出は1件も落とさない。
    // (バックグラウンド抽出が追いつくまでバッファは一時的に上限を超える)
    const n = SHORT_TERM_MAX_ENTRIES + 5;
    for (let i = 0; i < n; i++) await appendShortTerm(entry(i));
    expect((await getShortTerm()).length).toBe(n);
  });

  it('上限超過分は古い「抽出済み」エントリのみ落とす', async () => {
    const cap = SHORT_TERM_MAX_ENTRIES;
    // まず cap+1 件入れる(全未抽出 → cap+1 件保持される)。
    for (let i = 0; i < cap + 1; i++) await appendShortTerm(entry(i));
    // 古い10件を抽出済みにする。
    await markAsExtracted(Array.from({ length: 10 }, (_, i) => ts(i)));
    // もう1件追加 → cap+2 件・上限超過2件 → 最古の抽出済み2件(0,1)を落として cap 件。
    await appendShortTerm(entry(cap + 1));
    const list = await getShortTerm();
    expect(list.length).toBe(cap);
    expect(list.find((e) => e.timestamp === ts(0))).toBeUndefined();
    expect(list.find((e) => e.timestamp === ts(1))).toBeUndefined();
    // 3件目以降の抽出済み・未抽出は残る。
    expect(list.find((e) => e.timestamp === ts(2))).toBeDefined();
    expect(list.find((e) => e.timestamp === ts(cap + 1))).toBeDefined();
  });

  it('getUnextractedEntries は extracted:false のみ返す', async () => {
    await appendShortTerm(entry(1));
    await appendShortTerm(entry(2));
    await markAsExtracted([entry(1).timestamp]);
    const un = await getUnextractedEntries();
    expect(un.map((e) => e.timestamp)).toEqual([entry(2).timestamp]);
  });

  it('markAsExtracted は指定 timestamp のみ extracted にする', async () => {
    await appendShortTerm(entry(1));
    await appendShortTerm(entry(2));
    await markAsExtracted([entry(1).timestamp]);
    const list = await getShortTerm();
    expect(list.find((e) => e.timestamp === entry(1).timestamp)?.extracted).toBe(true);
    expect(list.find((e) => e.timestamp === entry(2).timestamp)?.extracted).toBe(false);
  });

  it('clearShortTerm はファイルを削除する', async () => {
    await appendShortTerm(entry(1));
    await clearShortTerm();
    expect(await getShortTerm()).toEqual([]);
  });
});

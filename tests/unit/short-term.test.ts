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
} from '../../src/memory/core/short-term';
import { SHORT_TERM_MAX_ENTRIES } from '../../src/shared/constants';
import type { ShortTermEntry } from '../../src/shared/types/memory';

function entry(i: number): Omit<ShortTermEntry, 'id'> {
  return {
    role: 'user',
    text: `m${i}`,
    timestamp: `2026-06-01T10:00:${String(i).padStart(2, '0')}+09:00`,
    extracted: false,
  };
}

const ts = (i: number): string => entry(i).timestamp;

/** 保存済みエントリのうち timestamp が一致するものの id を返す(id は appendShortTerm が採番)。 */
async function storedId(timestamp: string): Promise<string> {
  const found = (await getShortTerm()).find((e) => e.timestamp === timestamp);
  if (!found) throw new Error(`no stored entry with timestamp ${timestamp}`);
  return found.id;
}

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
    // 古い10件を抽出済みにする(保存済みエントリの id で指定)。
    await markAsExtracted((await getShortTerm()).slice(0, 10).map((e) => e.id));
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
    await markAsExtracted([await storedId(ts(1))]);
    const un = await getUnextractedEntries();
    expect(un.map((e) => e.timestamp)).toEqual([entry(2).timestamp]);
  });

  it('markAsExtracted は指定 id のみ extracted にする', async () => {
    await appendShortTerm(entry(1));
    await appendShortTerm(entry(2));
    await markAsExtracted([await storedId(ts(1))]);
    const list = await getShortTerm();
    expect(list.find((e) => e.timestamp === entry(1).timestamp)?.extracted).toBe(true);
    expect(list.find((e) => e.timestamp === entry(2).timestamp)?.extracted).toBe(false);
  });

  it('同一 timestamp でも id 単位でマークし、未抽出を巻き添えにしない(横断監査④)', async () => {
    // commitTurn は user→assistant を連続 append するため、同一秒(=同 timestamp)になりうる。
    const sameTs = '2026-06-01T10:00:00+09:00';
    await appendShortTerm({ role: 'user', text: 'u', timestamp: sameTs, extracted: false });
    await appendShortTerm({ role: 'assistant', text: 'a', timestamp: sameTs, extracted: false });
    const stored = await getShortTerm();
    expect(stored).toHaveLength(2);
    const userEntry = stored.find((e) => e.role === 'user');
    const assistantEntry = stored.find((e) => e.role === 'assistant');
    expect(userEntry).toBeDefined();
    expect(assistantEntry).toBeDefined();
    // 一意 id ゆえ user/assistant は別物(timestamp は同じ)。
    expect(userEntry?.id).not.toBe(assistantEntry?.id);
    // user だけ抽出済みにする → assistant は巻き添えにならない。
    await markAsExtracted([userEntry?.id ?? '']);
    const after = await getShortTerm();
    expect(after.find((e) => e.role === 'user')?.extracted).toBe(true);
    expect(after.find((e) => e.role === 'assistant')?.extracted).toBe(false);
  });

  it('clearShortTerm はファイルを削除する', async () => {
    await appendShortTerm(entry(1));
    await clearShortTerm();
    expect(await getShortTerm()).toEqual([]);
  });
});

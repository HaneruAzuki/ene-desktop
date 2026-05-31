import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getShortTermPath: (): string => `${h.memDir}/short-term.json`,
}));

import {
  getShortTerm,
  appendShortTerm,
  clearShortTerm,
  getUnextractedEntries,
  markAsExtracted,
} from '../../src/memory/short-term';
import type { ShortTermEntry } from '../../src/shared/types/memory';

function entry(i: number): ShortTermEntry {
  return {
    role: 'user',
    text: `m${i}`,
    timestamp: `2026-06-01T10:00:${String(i).padStart(2, '0')}+09:00`,
    extracted: false,
  };
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

  it('20件以内では onOverflow を呼ばない', async () => {
    const onOverflow = vi.fn(async () => {});
    for (let i = 0; i < 5; i++) await appendShortTerm(entry(i), onOverflow);
    expect(onOverflow).not.toHaveBeenCalled();
    expect((await getShortTerm()).length).toBe(5);
  });

  it('20件超過で onOverflow を呼び、20件にトリムする', async () => {
    const onOverflow = vi.fn(async () => {});
    for (let i = 0; i < 21; i++) await appendShortTerm(entry(i), onOverflow);
    expect(onOverflow).toHaveBeenCalled();
    expect((await getShortTerm()).length).toBe(20);
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

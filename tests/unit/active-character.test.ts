import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// active-character.json の保存先のみ差し替える(json-store は実物を使う)。
const h = vi.hoisted(() => ({ acPath: '', dir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getActiveCharacterPath: (): string => h.acPath,
}));

import {
  loadOrCreateActiveCharacter,
  markFirstLaunchCompleted,
  recordBirthdayCelebrated,
} from '../../src/character/active-character';

beforeEach(async () => {
  h.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-active-'));
  h.acPath = path.join(h.dir, 'active-character.json');
});
afterEach(async () => {
  await fs.rm(h.dir, { recursive: true, force: true });
});

describe('active-character (設計書 §5.4)', () => {
  it('初回はデフォルト値を生成して保存する', async () => {
    const a = await loadOrCreateActiveCharacter();
    expect(a.version).toBe(1);
    expect(a.characterId).toBe('ene');
    expect(a.firstLaunchCompleted).toBe(false);
    expect(a.birthdayHistory).toEqual([]);
    // 永続化され、2回目は同じ内容(同じ selectedAt)を読む
    const again = await loadOrCreateActiveCharacter();
    expect(again.selectedAt).toBe(a.selectedAt);
  });

  it('markFirstLaunchCompleted で firstLaunchCompleted が true になる', async () => {
    await loadOrCreateActiveCharacter();
    await markFirstLaunchCompleted();
    const a = await loadOrCreateActiveCharacter();
    expect(a.firstLaunchCompleted).toBe(true);
  });

  it('recordBirthdayCelebrated で該当年が celebrated になる', async () => {
    await recordBirthdayCelebrated(2026);
    const a = await loadOrCreateActiveCharacter();
    const entry = a.birthdayHistory.find((e) => e.year === 2026);
    expect(entry?.celebrated).toBe(true);
    expect(entry?.celebratedAt).toBeDefined();
  });
});

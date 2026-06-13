import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/shared/node/paths', () => ({
  getSemanticPath: (): string => `${h.memDir}/semantic.json`,
}));

import { getSemantic, updateSemantic, lockOwnerName } from '../../src/memory/semantic';

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-sem-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('semantic (設計書 §3.3)', () => {
  it('存在しなければ { version: 1 } を返す', async () => {
    expect(await getSemantic()).toEqual({ version: 1 });
  });

  it('updateSemantic は extra を深くマージする(既存値が残る)', async () => {
    await updateSemantic({ extra: { a: '1' } });
    await updateSemantic({ extra: { b: '2' } });
    const s = await getSemantic();
    expect(s.extra).toEqual({ a: '1', b: '2' });
  });

  it('updateSemantic はコアフィールドをマージする', async () => {
    await updateSemantic({ userName: '太郎' });
    await updateSemantic({ personality: ['几帳面'] });
    const s = await getSemantic();
    expect(s.userName).toBe('太郎');
    expect(s.personality).toEqual(['几帳面']);
    expect(s.version).toBe(1);
  });
});

describe('lockOwnerName (主人の名前の硬いロック・主人固定)', () => {
  it('まだ主人が未確定(空)なら userName を素通しする(=初代主人の確定)', () => {
    expect(lockOwnerName({ userName: 'ゆうや' }, undefined)).toEqual({ userName: 'ゆうや' });
    expect(lockOwnerName({ userName: 'ゆうや' }, '')).toEqual({ userName: 'ゆうや' });
  });

  it('主人が確定済みなら、別名への userName 変更を捨てる', () => {
    expect(lockOwnerName({ userName: 'まりこ' }, 'ゆうや')).toEqual({});
  });

  it('主人が確定済みでも、名前以外(読み・好み・誕生日)は素通しする', () => {
    const patch = {
      userName: 'まりこ',
      userNameReading: 'ゆうや',
      preferences: { 色: '青' },
      userBirthday: { month: 3, day: 4 },
    };
    expect(lockOwnerName(patch, 'ゆうや')).toEqual({
      userNameReading: 'ゆうや',
      preferences: { 色: '青' },
      userBirthday: { month: 3, day: 4 },
    });
  });

  it('userName を含まない patch はそのまま返す', () => {
    expect(lockOwnerName({ preferences: { 色: '青' } }, 'ゆうや')).toEqual({ preferences: { 色: '青' } });
  });

  it('元の patch を破壊しない(非破壊)', () => {
    const patch = { userName: 'まりこ', preferences: { 色: '青' } };
    lockOwnerName(patch, 'ゆうや');
    expect(patch.userName).toBe('まりこ'); // 入力は変えない
  });
});

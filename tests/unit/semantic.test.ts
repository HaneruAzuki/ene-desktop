import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../src/shared/node/paths', () => ({
  getSemanticPath: (): string => `${h.memDir}/semantic.json`,
}));

import { getSemantic, updateSemantic } from '../../src/memory/semantic';

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

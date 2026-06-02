import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({ dataDir: '', memDir: '' }));
vi.mock('../../src/storage/paths', () => ({
  getPortableDataDir: (): string => h.dataDir,
  getMemoryDir: (): string => h.memDir,
}));

import { ensureMemoryDirectories } from '../../src/main/init-directories';

beforeEach(async () => {
  h.dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-init-'));
  h.memDir = path.join(h.dataDir, 'memory', 'ene');
});
afterEach(async () => {
  await fs.rm(h.dataDir, { recursive: true, force: true });
});

describe('ensureMemoryDirectories (設計書 §7.1 ステップ8)', () => {
  it('episodic / config / logs ディレクトリを作成する', async () => {
    await ensureMemoryDirectories();
    expect(existsSync(path.join(h.memDir, 'episodic'))).toBe(true);
    expect(existsSync(path.join(h.dataDir, 'config'))).toBe(true);
    expect(existsSync(path.join(h.dataDir, 'logs'))).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// userData ディレクトリと safeStorage をモック。
// 暗号化の模擬は「文字列の反転」(往復可能 & 平文を含まない)。
const h = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: (): string => h.dir },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from([...s].reverse().join(''), 'utf8'),
    decryptString: (b: Buffer): string => [...Buffer.from(b).toString('utf8')].reverse().join(''),
  },
}));

import {
  encryptAndSaveApiKey,
  loadAndDecryptApiKey,
  isApiKeyAvailable,
} from '../../src/shared/node/encryption';

beforeEach(async () => {
  h.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-enc-'));
});
afterEach(async () => {
  await fs.rm(h.dir, { recursive: true, force: true });
});

describe('encryption (設計書 §3.6 / §6.3)', () => {
  it('暗号化保存したキーを復号できる(往復)', async () => {
    await encryptAndSaveApiKey('sk-ant-abc123');
    expect(await loadAndDecryptApiKey()).toBe('sk-ant-abc123');
  });

  it('isApiKeyAvailable は保存前 false・保存後 true', async () => {
    expect(await isApiKeyAvailable()).toBe(false);
    await encryptAndSaveApiKey('sk-ant-xyz');
    expect(await isApiKeyAvailable()).toBe(true);
  });

  it('保存ファイルは平文を含まない(暗号化されている)', async () => {
    await encryptAndSaveApiKey('sk-ant-secret');
    const raw = await fs.readFile(path.join(h.dir, 'api-key.enc'), 'utf8');
    expect(raw).not.toContain('sk-ant-secret');
  });

  it('キー未保存時 loadAndDecryptApiKey は null を返す', async () => {
    expect(await loadAndDecryptApiKey()).toBeNull();
  });
});

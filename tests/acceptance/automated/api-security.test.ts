import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 成功基準6(APIキー暗号化)の機構検証。
// safeStorage はモック(往復可能で平文を含まない「文字列反転」で代用)。
const h = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: (): string => h.dir },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from([...s].reverse().join(''), 'utf8'),
    decryptString: (b: Buffer): string => [...Buffer.from(b).toString('utf8')].reverse().join(''),
  },
}));

import { encryptAndSaveApiKey, loadAndDecryptApiKey } from '../../../src/storage/encryption';
import { getApiKeyPath } from '../../../src/storage/paths';

beforeEach(async () => {
  h.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-acc-enc-'));
});
afterEach(async () => {
  await fs.rm(h.dir, { recursive: true, force: true });
});

describe('受入: API キーの暗号化(成功基準6)', () => {
  it('保存ファイルに平文 sk-ant- が現れない(暗号化されている)', async () => {
    await encryptAndSaveApiKey('sk-ant-acceptance-secret-12345');
    const raw = await fs.readFile(getApiKeyPath(), 'utf8');
    expect(raw).not.toContain('sk-ant-');
  });

  it('暗号化保存したキーは復号して取り出せる(往復)', async () => {
    await encryptAndSaveApiKey('sk-ant-roundtrip-99');
    expect(await loadAndDecryptApiKey()).toBe('sk-ant-roundtrip-99');
  });

  it('保存先はマシン固定領域(userData)であり data/ 配下ではない', () => {
    // 別PCで復号できないため API キーだけは data/ ではなく %APPDATA% 配下に置く(CLAUDE §6.3)
    expect(getApiKeyPath()).toBe(path.join(h.dir, 'api-key.enc'));
    expect(getApiKeyPath()).not.toContain(`${path.sep}data${path.sep}`);
  });
});

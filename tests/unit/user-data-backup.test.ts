import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import {
  exportUserData,
  importUserData,
  looksLikeBackup,
  BACKUP_DIR_NAME,
} from '../../src/shared/node/user-data-backup';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(join(os.tmpdir(), 'ene-backup-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('user-data-backup (記憶のエクスポート/インポート・N-REL-2)', () => {
  it('export → import で記憶/設定が往復する(api-key は対象外)', async () => {
    const userData = join(tmp, 'userdata');
    await fs.mkdir(join(userData, 'memory', 'ene'), { recursive: true });
    await fs.writeFile(join(userData, 'memory', 'ene', 'semantic.json'), '{"x":1}');
    await fs.mkdir(join(userData, 'config'), { recursive: true });
    await fs.writeFile(join(userData, 'config', 'app-settings.json'), '{"y":2}');
    await fs.writeFile(join(userData, 'api-key.enc'), 'SECRET'); // 含まれないことを確認

    const dest = join(tmp, 'dest');
    const exp = await exportUserData(userData, dest);
    expect(exp.dirs.sort()).toEqual(['config', 'memory']);
    const backup = join(dest, BACKUP_DIR_NAME);
    expect(existsSync(join(backup, 'memory', 'ene', 'semantic.json'))).toBe(true);
    expect(existsSync(join(backup, 'config', 'app-settings.json'))).toBe(true);
    expect(existsSync(join(backup, 'api-key.enc'))).toBe(false); // 機械固定=含めない
    expect(looksLikeBackup(backup)).toBe(true);

    const restored = join(tmp, 'restored');
    const imp = await importUserData(backup, restored);
    expect(imp.dirs.sort()).toEqual(['config', 'memory']);
    expect(await fs.readFile(join(restored, 'memory', 'ene', 'semantic.json'), 'utf8')).toBe('{"x":1}');
    expect(await fs.readFile(join(restored, 'config', 'app-settings.json'), 'utf8')).toBe('{"y":2}');
  });

  it('looksLikeBackup は memory/config を含まないフォルダで false', () => {
    expect(looksLikeBackup(tmp)).toBe(false);
  });

  it('インポートは既存に上書き統合する(src に無いファイルは残す)', async () => {
    const backup = join(tmp, 'backup');
    await fs.mkdir(join(backup, 'memory'), { recursive: true });
    await fs.writeFile(join(backup, 'memory', 'a.json'), 'new');

    const userData = join(tmp, 'ud');
    await fs.mkdir(join(userData, 'memory'), { recursive: true });
    await fs.writeFile(join(userData, 'memory', 'a.json'), 'old'); // 上書きされる
    await fs.writeFile(join(userData, 'memory', 'b.json'), 'keep'); // 残る

    await importUserData(backup, userData);
    expect(await fs.readFile(join(userData, 'memory', 'a.json'), 'utf8')).toBe('new');
    expect(await fs.readFile(join(userData, 'memory', 'b.json'), 'utf8')).toBe('keep');
  });
});

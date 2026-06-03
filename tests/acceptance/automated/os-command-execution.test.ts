import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import path from 'node:path';

// 成功基準3(OS操作)+ セキュリティの機構検証。
// 実シェル/プロセスはモック(メモ帳やブラウザを実際には開かない)。
// 「メモ帳開いて」→ os_command 応答 という LLM 依存部分は手動プロトコルで確認する。

const h = vi.hoisted(() => ({ openExternal: vi.fn(), openPath: vi.fn(), spawn: vi.fn() }));
vi.mock('electron', () => ({ shell: { openExternal: h.openExternal, openPath: h.openPath } }));
vi.mock('node:child_process', () => ({ spawn: h.spawn }));

import { executeOsCommand } from '../../../src/os/executor';

beforeEach(() => {
  h.openExternal.mockReset().mockResolvedValue(undefined);
  h.openPath.mockReset().mockResolvedValue('');
  h.spawn.mockReset().mockReturnValue({ unref: vi.fn() });
});

describe('受入: OS操作のホワイトリスト(成功基準3 / セキュリティ)', () => {
  it('open_notepad はメモ帳を引数なしで起動する', async () => {
    const r = await executeOsCommand({ action: 'open_notepad' });
    expect(r.ok).toBe(true);
    expect(h.spawn).toHaveBeenCalledWith('notepad.exe', [], expect.objectContaining({ detached: true }));
  });

  it('open_browser は http/https のみ許可する', async () => {
    expect((await executeOsCommand({ action: 'open_browser', target: 'https://example.com' })).ok).toBe(true);
    expect((await executeOsCommand({ action: 'open_browser', target: 'javascript:alert(1)' })).ok).toBe(false);
    expect((await executeOsCommand({ action: 'open_browser', target: 'file:///etc/passwd' })).ok).toBe(false);
  });

  it('open_folder はパストラバーサルとホーム外を拒否する', async () => {
    const traversal = homedir() + path.sep + '..' + path.sep + 'Windows';
    expect((await executeOsCommand({ action: 'open_folder', target: traversal })).ok).toBe(false);
    expect((await executeOsCommand({ action: 'open_folder', target: 'C:\\Windows' })).ok).toBe(false);
    expect((await executeOsCommand({ action: 'open_folder', target: path.join(homedir(), 'Documents') })).ok).toBe(true);
  });

  it('失敗時はキャラ口調のフォールバック message を返す', async () => {
    const r = await executeOsCommand({ action: 'open_folder', target: 'C:\\Windows' });
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });
});

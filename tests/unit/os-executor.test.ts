import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({
  openExternal: vi.fn(),
  openPath: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('electron', () => ({ shell: { openExternal: h.openExternal, openPath: h.openPath } }));
vi.mock('node:child_process', () => ({ spawn: h.spawn }));

import { executeOsCommand } from '../../src/os/executor';

beforeEach(() => {
  h.openExternal.mockReset().mockResolvedValue(undefined);
  h.openPath.mockReset().mockResolvedValue(''); // '' = 成功
  h.spawn.mockReset().mockReturnValue({ unref: vi.fn() });
});

describe('executeOsCommand (設計書 §3.5 / 要件 §2.10)', () => {
  it('open_notepad は引数なしで notepad.exe を起動する', async () => {
    const r = await executeOsCommand({ action: 'open_notepad' });
    expect(r.ok).toBe(true);
    expect(h.spawn).toHaveBeenCalledWith('notepad.exe', [], expect.objectContaining({ detached: true }));
  });

  it('open_browser(https)は成功する', async () => {
    const r = await executeOsCommand({ action: 'open_browser', target: 'https://example.com' });
    expect(r.ok).toBe(true);
    expect(h.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('open_browser(javascript:)を拒否し shell を呼ばない', async () => {
    const r = await executeOsCommand({ action: 'open_browser', target: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('non_https');
    expect(r.message).toBeTruthy(); // キャラ口調フォールバック
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it('open_browser(file:/smb:)を拒否する', async () => {
    expect((await executeOsCommand({ action: 'open_browser', target: 'file:///etc/passwd' })).ok).toBe(false);
    expect((await executeOsCommand({ action: 'open_browser', target: 'smb://server/share' })).ok).toBe(false);
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it('open_folder(ホーム配下)は成功する', async () => {
    const r = await executeOsCommand({ action: 'open_folder', target: path.join(homedir(), 'Documents') });
    expect(r.ok).toBe(true);
    expect(h.openPath).toHaveBeenCalled();
  });

  it('open_folder(C:\\Windows)をホーム外として拒否する', async () => {
    const r = await executeOsCommand({ action: 'open_folder', target: 'C:\\Windows' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('outside_home');
    expect(h.openPath).not.toHaveBeenCalled();
  });

  it('open_folder(".." を含む)を path_traversal として拒否する', async () => {
    const traversal = homedir() + path.sep + '..' + path.sep + 'Windows';
    const r = await executeOsCommand({ action: 'open_folder', target: traversal });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('path_traversal');
    expect(h.openPath).not.toHaveBeenCalled();
  });

  it('open_folder(相対パス)を invalid_target として拒否する', async () => {
    const r = await executeOsCommand({ action: 'open_folder', target: 'relative/path' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_target');
  });

  it('target 無しの open_browser は invalid_target', async () => {
    const r = await executeOsCommand({ action: 'open_browser' });
    expect(r.reason).toBe('invalid_target');
  });
});

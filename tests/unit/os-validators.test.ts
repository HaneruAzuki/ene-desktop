import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import path from 'node:path';
import { validateUrl, validatePath } from '../../src/app/main/os/validators';

describe('validateUrl (設計書 §3.5)', () => {
  it('http/https を許可する', () => {
    expect(validateUrl('http://example.com').ok).toBe(true);
    expect(validateUrl('https://example.com').ok).toBe(true);
  });
  it('javascript: / file: / smb: を拒否する', () => {
    expect(validateUrl('javascript:alert(1)')).toEqual({ ok: false, reason: 'non_https' });
    expect(validateUrl('file:///etc/passwd')).toEqual({ ok: false, reason: 'non_https' });
    expect(validateUrl('smb://server/share')).toEqual({ ok: false, reason: 'non_https' });
  });
  it('URL でない文字列を拒否する', () => {
    expect(validateUrl('これはURLではない').ok).toBe(false);
  });
});

describe('validatePath (設計書 §3.5)', () => {
  it('ホーム配下の絶対パスを許可する', () => {
    expect(validatePath(path.join(homedir(), 'Documents')).ok).toBe(true);
  });
  it('相対パスを拒否する(invalid_target)', () => {
    expect(validatePath('relative/path')).toEqual({ ok: false, reason: 'invalid_target' });
  });
  it('".." を含むパスを拒否する(path_traversal)', () => {
    const traversal = homedir() + path.sep + '..' + path.sep + 'Windows';
    expect(validatePath(traversal)).toEqual({ ok: false, reason: 'path_traversal' });
  });
  it('ホーム外の絶対パスを拒否する(outside_home)', () => {
    expect(validatePath('C:\\Windows')).toEqual({ ok: false, reason: 'outside_home' });
  });
});

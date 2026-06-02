import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';

// electron をモック(app.isPackaged / getPath)
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string): string =>
      name === 'userData' ? path.join(os.tmpdir(), 'ene-ud') : os.tmpdir(),
  },
}));

// json-store をモックして refreshActiveCharacterId を制御
const h = vi.hoisted(() => ({ readJson: vi.fn() }));
vi.mock('../../src/storage/json-store', () => ({ readJson: h.readJson }));

import { app } from 'electron';
import {
  getPortableDataDir,
  getMemoryDir,
  getEpisodicDir,
  getSemanticPath,
  getShortTermPath,
  getActiveCharacterPath,
  getApiKeyPath,
  getMachineDataDir,
  setActiveCharacterId,
  refreshActiveCharacterId,
} from '../../src/storage/paths';

function setPackaged(v: boolean): void {
  (app as unknown as { isPackaged: boolean }).isPackaged = v;
}

beforeEach(() => {
  h.readJson.mockReset();
  setActiveCharacterId('ene');
  setPackaged(false);
});

describe('paths (設計書 §3.6 / §5.5)', () => {
  it('開発時は cwd/data を返す', () => {
    expect(getPortableDataDir()).toBe(path.join(process.cwd(), 'data'));
  });

  it('本番時(isPackaged)は exe ディレクトリ/data を返す', () => {
    setPackaged(true);
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    expect(getPortableDataDir()).toBe(path.join(path.dirname(process.execPath), 'data'));
  });

  it('portable 本番時は PORTABLE_EXECUTABLE_DIR/data を返す', () => {
    setPackaged(true);
    process.env.PORTABLE_EXECUTABLE_DIR = 'D:\\apps\\ENE';
    try {
      expect(getPortableDataDir()).toBe(path.join('D:\\apps\\ENE', 'data'));
    } finally {
      delete process.env.PORTABLE_EXECUTABLE_DIR;
    }
  });

  it('getMemoryDir は active キャラ ID を反映する', () => {
    setActiveCharacterId('takeshi');
    expect(getMemoryDir()).toBe(path.join(process.cwd(), 'data', 'memory', 'takeshi'));
  });

  it('refreshActiveCharacterId は active-character.json の characterId を参照する', async () => {
    h.readJson.mockResolvedValue({ characterId: 'takeshi' });
    const id = await refreshActiveCharacterId();
    expect(id).toBe('takeshi');
    expect(h.readJson).toHaveBeenCalledWith(getActiveCharacterPath());
    expect(getMemoryDir()).toContain(path.join('memory', 'takeshi'));
  });

  it('episodic/semantic/short-term は memory ディレクトリ配下に構築される', () => {
    setActiveCharacterId('ene');
    const base = path.join(process.cwd(), 'data', 'memory', 'ene');
    expect(getEpisodicDir(2026, 'health')).toBe(path.join(base, 'episodic', '2026', 'health'));
    expect(getSemanticPath()).toBe(path.join(base, 'semantic.json'));
    expect(getShortTermPath()).toBe(path.join(base, 'short-term.json'));
  });

  it('マシン固定データと API キーパスは userData 配下', () => {
    expect(getMachineDataDir()).toBe(path.join(os.tmpdir(), 'ene-ud'));
    expect(getApiKeyPath()).toBe(path.join(os.tmpdir(), 'ene-ud', 'api-key.enc'));
  });
});

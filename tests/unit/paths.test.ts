import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';

// json-store/appPath をモックして refreshCharacterId / getAppPath を制御
const h = vi.hoisted(() => ({ readJson: vi.fn(), appPath: process.cwd() }));

// electron をモック(app.isPackaged / getPath / getAppPath)
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string): string =>
      name === 'userData' ? path.join(os.tmpdir(), 'ene-ud') : os.tmpdir(),
    getAppPath: (): string => h.appPath,
  },
}));

vi.mock('../../src/shared/node/json-store', () => ({ readJson: h.readJson }));

import { app } from 'electron';
import {
  getPortableDataDir,
  getUserDataDir,
  getMemoryDir,
  getEpisodicDir,
  getSemanticPath,
  getShortTermPath,
  getCharacterStatePath,
  getApiKeyPath,
  getMachineDataDir,
  getVadModelPath,
  setCharacterId,
  refreshCharacterId,
} from '../../src/shared/node/paths';

function setPackaged(v: boolean): void {
  (app as unknown as { isPackaged: boolean }).isPackaged = v;
}

beforeEach(() => {
  h.readJson.mockReset();
  h.appPath = process.cwd();
  setCharacterId('ene');
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

  it('getUserDataDir は開発時 cwd/data、本番時 Electron userData を返す(N-REL-2)', () => {
    expect(getUserDataDir()).toBe(path.join(process.cwd(), 'data'));
    setPackaged(true);
    expect(getUserDataDir()).toBe(path.join(os.tmpdir(), 'ene-ud'));
  });

  it('getMemoryDir は active キャラ ID を反映する', () => {
    setCharacterId('takeshi');
    expect(getMemoryDir()).toBe(path.join(process.cwd(), 'data', 'memory', 'takeshi'));
  });

  it('refreshCharacterId は active-character.json の characterId を参照する', async () => {
    h.readJson.mockResolvedValue({ characterId: 'takeshi' });
    const id = await refreshCharacterId();
    expect(id).toBe('takeshi');
    expect(h.readJson).toHaveBeenCalledWith(getCharacterStatePath());
    expect(getMemoryDir()).toContain(path.join('memory', 'takeshi'));
  });

  it('episodic/semantic/short-term は memory ディレクトリ配下に構築される', () => {
    setCharacterId('ene');
    const base = path.join(process.cwd(), 'data', 'memory', 'ene');
    expect(getEpisodicDir(2026, 'health')).toBe(path.join(base, 'episodic', '2026', 'health'));
    expect(getSemanticPath()).toBe(path.join(base, 'semantic.json'));
    expect(getShortTermPath()).toBe(path.join(base, 'short-term.json'));
  });

  it('マシン固定データと API キーパスはユーザーデータ root 配下(N-REL-2)', () => {
    // dev(isPackaged=false)= cwd/data。packaged では Electron userData。
    expect(getMachineDataDir()).toBe(path.join(process.cwd(), 'data'));
    expect(getApiKeyPath()).toBe(path.join(process.cwd(), 'data', 'api-key.enc'));
    setPackaged(true);
    expect(getApiKeyPath()).toBe(path.join(os.tmpdir(), 'ene-ud', 'api-key.enc'));
  });

  it('getVadModelPath は packaged(app.asar)では asar.unpacked 側の実ファイルを指す', () => {
    // ネイティブ onnxruntime は asar 内を開けないため、asarUnpack された実体側へ向ける必要がある。
    h.appPath = path.join(os.tmpdir(), 'win-unpacked', 'resources', 'app.asar');
    expect(getVadModelPath()).toBe(
      path.join(os.tmpdir(), 'win-unpacked', 'resources', 'app.asar.unpacked', 'resources', 'silero_vad.onnx'),
    );
  });

  it('getVadModelPath は dev(app.asar を含まない)では置換しない', () => {
    h.appPath = path.join(os.tmpdir(), 'proj');
    expect(getVadModelPath()).toBe(path.join(os.tmpdir(), 'proj', 'resources', 'silero_vad.onnx'));
  });
});

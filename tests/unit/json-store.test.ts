import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson, listJsonFiles } from '../../src/shared/node/json-store';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-json-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('json-store (設計書 §3.6)', () => {
  it('readJson は存在しないファイルで null を返す', async () => {
    expect(await readJson(path.join(dir, 'nope.json'))).toBeNull();
  });

  it('writeJson はネストしたディレクトリを再帰作成し、readJson で往復できる', async () => {
    const p = path.join(dir, 'a', 'b', 'c.json');
    await writeJson(p, { x: 1, y: 'あ' });
    expect(await readJson(p)).toEqual({ x: 1, y: 'あ' });
  });

  it('writeJson は一時ファイル(.tmp)を残さない', async () => {
    const p = path.join(dir, 'd.json');
    await writeJson(p, { ok: true });
    const names = await fs.readdir(dir);
    expect(names.filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
  });

  it('writeJson は既存ファイルを上書きする(アトミック置換)', async () => {
    const p = path.join(dir, 'e.json');
    await writeJson(p, { v: 1 });
    await writeJson(p, { v: 2 });
    expect(await readJson(p)).toEqual({ v: 2 });
  });

  it('readJson は不正な JSON で throw する', async () => {
    const p = path.join(dir, 'bad.json');
    await fs.writeFile(p, '{ not valid json', 'utf8');
    await expect(readJson(p)).rejects.toThrow();
  });

  it('listJsonFiles は存在しないディレクトリで空配列を返す', async () => {
    expect(await listJsonFiles(path.join(dir, 'missing'))).toEqual([]);
  });

  it('listJsonFiles は .json ファイルのみ返す(ディレクトリ・他拡張子は除外)', async () => {
    await fs.writeFile(path.join(dir, 'a.json'), '{}', 'utf8');
    await fs.writeFile(path.join(dir, 'b.txt'), 'x', 'utf8');
    await fs.mkdir(path.join(dir, 'sub.json')); // .json 名のディレクトリ
    const list = await listJsonFiles(dir);
    expect(list).toEqual(['a.json']);
  });
});

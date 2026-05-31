import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// 平文 JSON の汎用読み書き(設計書 §3.6 / §6.1)。
// すべて fs.promises を使う(同期 I/O 禁止・CLAUDE.md §12)。
// 記憶・設定ファイルは平文 JSON で保存する(暗号化しない・CLAUDE.md §6.3)。

/**
 * JSON ファイルを読み込む。
 * - ファイルが存在しない場合は null を返す。
 * - JSON パースエラーは呼出側に throw する(壊れた内容を握り潰さない)。
 */
export async function readJson<T>(path: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw e;
  }
  return JSON.parse(raw) as T;
}

/**
 * JSON ファイルを書き込む。
 * - 親ディレクトリが存在しなければ再帰的に作成する。
 * - 一時ファイルに書いてから rename することでアトミックに置換する
 *   (書込中断時に中途半端なファイルを残さない)。
 */
export async function writeJson<T>(path: string, data: T): Promise<void> {
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true });

  const tmp = join(dir, `.${randomUUID()}.tmp`);
  const text = JSON.stringify(data, null, 2);
  try {
    await fs.writeFile(tmp, text, 'utf8');
    // rename は同一ボリューム内でアトミック。既存ファイルは置換される。
    await fs.rename(tmp, path);
  } catch (e) {
    // 失敗時は一時ファイルを掃除しておく(残骸を残さない)。
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/**
 * ディレクトリ直下の `.json` ファイル名(ディレクトリは除く)を返す。
 * - ディレクトリが存在しない場合は空配列を返す。
 */
export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.json'))
      .map((d) => d.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw e;
  }
}

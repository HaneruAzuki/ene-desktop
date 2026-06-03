import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// 成功基準7(配布サイズ 100MB 以下)の検証。
// 配布 exe は dist/ 配下に生成され Git 管理外のため、未ビルド環境では skip する
// (CPU/メモリの実測値は手動プロトコルで確認する)。
const DIST_DIR = path.join(process.cwd(), 'dist');
const MAX_BYTES = 100 * 1024 * 1024; // 100MB

function findExe(): string | null {
  if (!existsSync(DIST_DIR)) return null;
  const exe = readdirSync(DIST_DIR).find((f) => f.toLowerCase().endsWith('.exe'));
  return exe ? path.join(DIST_DIR, exe) : null;
}

const exePath = findExe();

describe('受入: 配布物のサイズ(成功基準7)', () => {
  it.skipIf(exePath === null)('配布 exe は 100MB 以下である', () => {
    // skipIf により exePath は非 null
    const size = statSync(exePath as string).size;
    expect(size).toBeLessThan(MAX_BYTES);
  });
});

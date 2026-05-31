import { homedir } from 'node:os';
import path from 'node:path';
import type { OsCommandFailureReason } from '../shared/types/os';

// ターゲット検証(設計書 §3.5「セキュリティ考慮」)。

export interface ValidationResult {
  ok: boolean;
  reason?: OsCommandFailureReason;
}

/** URL は http/https のみ許可(javascript:/file:/smb: 等は拒否)。 */
export function validateUrl(url: string): ValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_target' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'non_https' };
  }
  if (!parsed.hostname) {
    return { ok: false, reason: 'invalid_target' };
  }
  return { ok: true };
}

/** フォルダパスはユーザーホーム配下の絶対パスのみ許可(`..` 拒否・境界チェック)。 */
export function validatePath(targetPath: string): ValidationResult {
  // 1. 絶対パスであること
  if (!path.isAbsolute(targetPath)) {
    return { ok: false, reason: 'invalid_target' };
  }
  // 2. パストラバーサル(".." セグメント)を拒否
  if (targetPath.split(/[\\/]/).includes('..')) {
    return { ok: false, reason: 'path_traversal' };
  }
  // 3. ホームディレクトリ配下であること(境界チェック)
  try {
    const home = path.resolve(homedir());
    const resolved = path.resolve(targetPath);
    const rel = path.relative(home, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, reason: 'outside_home' };
    }
  } catch {
    return { ok: false, reason: 'invalid_target' };
  }
  return { ok: true };
}

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, getLogsDir, getMemoryDir } from '../../../shared/node/paths';

// 記憶・設定・ログ用ディレクトリを起動時に用意する(設計書 §7.1 ステップ8)。
// 置き場の正本は paths.ts。root をこのファイルで再導出せず必ず getter を使う
// (N-REL-2 で config/logs は userData 配下へ移動済み。getter 経由なら追従漏れが起きない)。
// getMemoryDir() は active キャラ ID(キャッシュ済み)に依存するため、
// buildCharacterContext()(= setCharacterId)後に呼ぶこと。

export async function ensureMemoryDirectories(): Promise<void> {
  await Promise.all([
    fs.mkdir(join(getMemoryDir(), 'episodic'), { recursive: true }),
    fs.mkdir(getConfigDir(), { recursive: true }),
    fs.mkdir(getLogsDir(), { recursive: true }),
  ]);
}

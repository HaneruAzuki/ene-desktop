import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir, getPortableDataDir } from '../storage/paths';

// 記憶・設定・ログ用ディレクトリの初期化(設計書 §7.1 ステップ8)。
// getMemoryDir() は active キャラ ID(キャッシュ済み)に依存するため、
// buildCharacterContext() 後(= setActiveCharacterId 後)に呼ぶこと。

export async function ensureMemoryDirectories(): Promise<void> {
  const dataDir = getPortableDataDir();
  await fs.mkdir(join(getMemoryDir(), 'episodic'), { recursive: true });
  await fs.mkdir(join(dataDir, 'config'), { recursive: true });
  await fs.mkdir(join(dataDir, 'logs'), { recursive: true });
}

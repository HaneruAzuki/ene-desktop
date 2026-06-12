import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { getApiKeyPath } from './paths';

// API キーの暗号化保存・復号(設計書 §3.6 / §6.3)。
//
// 暗号化対象は API キーのみ(記憶・設定ファイルは平文 JSON)。
// Electron safeStorage(OS 標準の暗号化機構)を使用。鍵は OS/ユーザー/マシンに
// 紐づくため、保存先は data/ ではなく %APPDATA%/ene-desktop/ とする(§6.3)。

/**
 * API キーを暗号化して %APPDATA%/ene-desktop/api-key.enc に保存する。
 * 暗号化が利用できない環境では throw する(呼出側でダイアログ表示等を行う)。
 */
export async function encryptAndSaveApiKey(plaintext: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage による暗号化が利用できません');
  }
  const encrypted = safeStorage.encryptString(plaintext);
  const target = getApiKeyPath();
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, encrypted);
}

/**
 * 保存済み API キーを復号して返す。
 * ファイルが無い・復号できない・暗号化が使えない等の場合は null を返す(throw しない)。
 */
export async function loadAndDecryptApiKey(): Promise<string | null> {
  try {
    const encrypted = await fs.readFile(getApiKeyPath());
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

/** API キーが保存済みかを返す(ファイルの存在確認)。 */
export async function isApiKeyAvailable(): Promise<boolean> {
  try {
    await fs.access(getApiKeyPath());
    return true;
  } catch {
    return false;
  }
}

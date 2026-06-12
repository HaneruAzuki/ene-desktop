import type { BrowserWindow } from 'electron';
import { log } from '../../shared/logger';
import { openApiKeyDialog } from './api-key-dialog';

// APIキー失効時の自動再表示(設計書 §6.1)。
// 401/402/429 を検知したら API キーダイアログを再表示する。

export async function handleApiAuthError(
  error: unknown,
  parent?: BrowserWindow,
  onSaved?: (key: string) => void,
): Promise<void> {
  const status = (error as { status?: number }).status;
  log.error(`API authentication error: status=${status ?? 'unknown'}`);
  await openApiKeyDialog(parent, onSaved);
}

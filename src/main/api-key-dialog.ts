import type { BrowserWindow } from 'electron';
import { log } from '../shared/logger';

// API キー管理ダイアログ(設計書 §3.7)。
// task_07 では仮実装(スタブ)。実体は task_09 で実装する。

export function openApiKeyDialog(_parent?: BrowserWindow): void {
  log.info('openApiKeyDialog called (stub; 実装は task_09)');
}

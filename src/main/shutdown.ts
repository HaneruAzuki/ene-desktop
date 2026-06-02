import { log } from '../shared/logger';
import { extractFromShortTerm } from '../memory/extraction-trigger';
import { clearShortTerm } from '../memory/short-term';
import { makeLlmComplete } from '../conversation/client';
import type { AppRuntime } from './ipc';

// 終了シーケンス(設計書 §7.2)。
// 1) 未抽出の短期記憶を中期記憶へ抽出 → 2) 短期記憶ファイル削除。
// 失敗しても終了は妨げない(記憶は失われるがアプリは終了する)。

export async function runShutdownSequence(runtime: AppRuntime): Promise<void> {
  log.info('shutdown sequence started');

  if (runtime.apiKey) {
    try {
      await extractFromShortTerm('shutdown', makeLlmComplete(runtime.apiKey));
    } catch (e) {
      log.warn('memory extraction on shutdown failed', { name: (e as Error).name });
    }
  }

  try {
    await clearShortTerm();
  } catch (e) {
    log.warn('failed to clear short-term memory', { name: (e as Error).name });
  }

  log.info('shutdown sequence complete');
}

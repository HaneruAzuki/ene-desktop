import { log } from '../../shared/logger';
import { flushExtraction } from '../../memory/extraction-scheduler';
import { clearShortTerm } from '../../memory/short-term';
import { makeLlmComplete } from '../../conversation/client';
import { stopVoiceEngine } from './voice-engine';
import type { AppRuntime } from './app-runtime';

// 終了シーケンス(設計書 §7.2)。
// 0) 音声サイドカーを停止(自分が起動した場合のみ・孤児プロセス防止・N-17-12)。
// 1) 未抽出の短期記憶を中期記憶へ抽出 → 2) 短期記憶ファイル削除。
// 失敗しても終了は妨げない(記憶は失われるがアプリは終了する)。

export async function runShutdownSequence(runtime: AppRuntime): Promise<void> {
  log.info('shutdown sequence started');

  // 記憶抽出より先にエンジンを止める(確実に子プロセスを回収する)。
  try {
    await stopVoiceEngine();
  } catch (e) {
    log.warn('failed to stop voice engine', { name: (e as Error).name });
  }

  if (runtime.apiKey) {
    try {
      // 走行中のバックグラウンド抽出(B-01)を待ってから、残った未抽出を全て抽出する。
      // これを待たずに短期記憶を消すと、抽出途中の記憶を取りこぼす。
      await flushExtraction(makeLlmComplete(runtime.apiKey));
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

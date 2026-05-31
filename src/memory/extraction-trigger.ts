import { log } from '../shared/logger';
import { getUnextractedEntries, markAsExtracted } from './short-term';
import { saveEpisodic } from './episodic';
import { updateSemantic } from './semantic';
import { extractMemoryFromConversation, type LlmComplete } from './extractor';

// 抽出トリガの統合(設計書 §3.3 / §7.2)。
// 呼出箇所: 短期記憶 20件超過時(appendShortTerm の onOverflow)、アプリ終了時(task_10)。

export async function extractFromShortTerm(
  reason: 'overflow' | 'shutdown',
  complete: LlmComplete,
): Promise<void> {
  const unextracted = await getUnextractedEntries();
  if (unextracted.length === 0) return;

  // ログにはメタ情報のみ(件数・理由)。会話内容は記録しない(CLAUDE §6.2)。
  log.info(`memory extraction triggered: reason=${reason}, entries=${unextracted.length}`);

  const { episodic, semanticPatch } = await extractMemoryFromConversation(unextracted, complete);
  if (episodic) {
    await saveEpisodic(episodic);
  }
  if (semanticPatch) {
    await updateSemantic(semanticPatch);
  }
  // 抽出に使ったエントリへフラグを立てる(再抽出防止)。
  await markAsExtracted(unextracted.map((e) => e.timestamp));
}

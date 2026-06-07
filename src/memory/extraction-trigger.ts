import { log } from '../shared/logger';
import { getUnextractedEntries, markAsExtracted } from './short-term';
import { saveEpisodic } from './episodic';
import { indexEpisodic } from './index-inverted';
import { retrieveRecords } from './retriever';
import { applyCorrections } from './update';
import { updateSemantic } from './semantic';
import { extractMemoryFromConversation, type LlmComplete } from './extractor';

// 抽出トリガの統合(設計書 §3.3 / §7.2 / task_15 の2層フロー)。
// 呼出箇所: 短期記憶 20件超過時(appendShortTerm の onOverflow)、アプリ終了時(task_10)。
//
// 2層フロー(task_15「抽出フローの変更」):
//   (live) 会話時は retriever が旧記憶をプロンプトに載せる(別経路・ここでは扱わない)。
//   (persist) ここで未抽出会話に対し retriever を1回回し、relevantMemories を抽出器へ渡す。
//             得た corrections を update.ts で非破壊適用する(自動上書きでなく supersede)。

export async function extractFromShortTerm(
  reason: 'overflow' | 'shutdown',
  complete: LlmComplete,
): Promise<void> {
  const unextracted = await getUnextractedEntries();
  if (unextracted.length === 0) return;

  // ログにはメタ情報のみ(件数・理由)。会話内容は記録しない(CLAUDE §6.2)。
  log.info(`memory extraction triggered: reason=${reason}, entries=${unextracted.length}`);

  // persist 層の想起: 未抽出会話を引き金に関連する旧記憶を集め、矛盾検知の材料にする。
  const conversationText = unextracted
    .filter((e) => e.role === 'user')
    .map((e) => e.text)
    .join('\n');
  const relevantMemories = await retrieveRecords({ text: conversationText });

  const { episodic, semanticPatch, corrections } = await extractMemoryFromConversation(
    unextracted,
    relevantMemories,
    complete,
  );

  // 先に新記録を保存して ID を得る(supersede の置換先に使う)。
  let newRecordId: string | undefined;
  if (episodic) {
    newRecordId = await saveEpisodic(episodic);
    await indexEpisodic(newRecordId, episodic);
  }
  if (corrections && corrections.length > 0) {
    await applyCorrections(corrections, newRecordId);
  }
  if (semanticPatch) {
    await updateSemantic(semanticPatch);
  }
  // 抽出に使ったエントリへフラグを立てる(再抽出防止)。
  await markAsExtracted(unextracted.map((e) => e.timestamp));
}

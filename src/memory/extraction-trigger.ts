import { log } from '../shared/logger';
import { nowLocalIso } from '../shared/datetime';
import { getUnextractedEntries, markAsExtracted } from './short-term';
import { saveEpisodic, loadAllEpisodicFiles } from './episodic';
import { indexEpisodic } from './index-inverted';
import { retrieveRecords } from './retriever';
import { applyCorrections } from './update';
import { resolveOpenLoop } from './open-loops';
import { updateSemantic } from './semantic';
import { extractMemoryFromConversation, type LlmComplete } from './extractor';

// 抽出トリガの統合(設計書 §3.3 / §7.2 / task_15 の2層フロー)。
// 呼出箇所: バックグラウンド抽出(extraction-scheduler の requestExtraction・未抽出が閾値以上で発火)、
//           アプリ終了/孤児回収時(flushExtraction → reason='shutdown'・task_10)。応答経路では呼ばない(B-01)。
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

  // P4: 現在「気にかけている」未解決の事柄を抽出器に見せ、結末が会話に出たら閉じてもらう。
  // 想起(話題依存)では拾えない未解決ループも閉じられるよう、全件から未解決を直接集める(canon に openLoop は無い)。
  const allRecords = await loadAllEpisodicFiles();
  const openLoopRecords = allRecords.filter(
    (r) => r.memory.openLoop && !r.memory.openLoop.resolvedAt,
  );

  const { episodic, semanticPatch, corrections, loopClosures } = await extractMemoryFromConversation(
    unextracted,
    relevantMemories,
    complete,
    openLoopRecords,
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
  // P4: 結末が出た「気にかけ」を閉じる(resolvedAt を立てる・非破壊更新)。best-effort。
  if (loopClosures && loopClosures.length > 0) {
    const resolvedAt = nowLocalIso();
    for (const closure of loopClosures) {
      try {
        await resolveOpenLoop(closure.targetFile, resolvedAt);
      } catch (e) {
        log.warn('open-loop closure failed', { name: (e as Error).name });
      }
    }
  }
  if (semanticPatch) {
    await updateSemantic(semanticPatch);
  }
  // 抽出に使ったエントリへフラグを立てる(再抽出防止)。
  await markAsExtracted(unextracted.map((e) => e.timestamp));
}

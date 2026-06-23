import { log } from '../shared/logger';
import { nowLocalIso } from '../shared/datetime';
import {
  RELEVANT_MEMORIES_CORRECTION_LIMIT,
  RECENT_RECORDS_FOR_CORRECTION,
} from '../shared/constants';
import { getUnextractedEntries, markAsExtracted } from './short-term';
import { loadAllEpisodicFiles, updateEpisodicById } from './episodic';
import { loadLifeMemory } from './life-memory';
import { saveAndIndexEpisodic } from './episodic-write';
import { indexEpisodic } from './index-inverted';
import { retrieveRecords } from './retriever';
import { applyCorrections } from './update';
import { resolveOpenLoop } from './open-loops';
import { getSemantic, updateSemantic, lockOwnerName } from './semantic';
import { extractMemoryFromConversation } from './extractor';
import { hasCorrectionCue, augmentWithRecent } from './correction-cues';
import { findNearDuplicate, mergeEpisodic } from './episodic-dedup';
import { getDefaultEmbedder, isEmbeddingModelAvailable } from '../shared/node/embedder';
import type { EpisodicMemory, EpisodicRecord } from '../shared/types/memory';
import type { LlmComplete } from '../shared/types/llm';

// 抽出トリガの統合(設計書 §3.3 / §7.2 / task_15 の2層フロー)。
// 呼出箇所: バックグラウンド抽出(extraction-scheduler の requestExtraction・未抽出が閾値以上で発火)、
//           アプリ終了/孤児回収時(flushExtraction → reason='shutdown'・task_10)。応答経路では呼ばない(B-01)。
//
// 2層フロー(task_15「抽出フローの変更」):
//   (live) 会話時は retriever が旧記憶をプロンプトに載せる(別経路・ここでは扱わない)。
//   (persist) ここで未抽出会話に対し retriever を1回回し、relevantMemories を抽出器へ渡す。
//             得た corrections を update.ts で非破壊適用する(自動上書きでなく supersede)。
//
// 精査対応(2026-06-23):
//   P3 = 近似重複は新規作成せず既存へマージ(saveOrMergeEpisodic・重複の無限蓄積を断つ)。
//   P4 = 訂正の合図がある会話では関連記憶の窓を広げ直近を補強(斜めの訂正を対象記憶へ届かせる)。

/**
 * P3: 近似重複なら新規作成せず既存へマージする。
 * モデル不在/判定失敗時は素直に新規保存へ倒す(会話を妨げない・既定の挙動を壊さない)。
 */
async function saveOrMergeEpisodic(
  episodic: EpisodicMemory,
  writableExisting: EpisodicRecord[],
): Promise<string> {
  if (await isEmbeddingModelAvailable()) {
    try {
      const dup = await findNearDuplicate(episodic, writableExisting, getDefaultEmbedder());
      if (dup) {
        const patch = mergeEpisodic(dup.memory, episodic);
        await updateEpisodicById(dup.id, patch);
        await indexEpisodic(dup.id, { ...dup.memory, ...patch }); // 増えた entity/tag を索引へ
        log.info('memory near-duplicate merged into existing record (no new file)');
        return dup.id;
      }
    } catch (e) {
      log.warn('near-duplicate check failed; saving as new', { name: (e as Error).name });
    }
  }
  return saveAndIndexEpisodic(episodic);
}

export async function extractFromShortTerm(
  reason: 'overflow' | 'shutdown',
  complete: LlmComplete,
): Promise<void> {
  const unextracted = await getUnextractedEntries();
  if (unextracted.length === 0) return;

  // ログにはメタ情報のみ(件数・理由)。会話内容は記録しない(CLAUDE §6.2)。
  log.info(`memory extraction triggered: reason=${reason}, entries=${unextracted.length}`);

  // 想起・「気にかけ」走査・近似重複判定で同じ episodic を二重ロードしない(D3)。1回だけ読む。
  // user(書込可能)と canon(read-only)を分けて持つ:想起プールは両方、重複マージは user のみが対象。
  const [userRecords, canon] = await Promise.all([loadAllEpisodicFiles(), loadLifeMemory()]);
  const recallPool = [...userRecords, ...canon];

  // persist 層の想起: 未抽出会話を引き金に関連する旧記憶を集め、矛盾検知の材料にする。
  const conversationText = unextracted
    .filter((e) => e.role === 'user')
    .map((e) => e.text)
    .join('\n');

  // P4: 訂正の合図があれば、関連記憶の窓を広げ(limit↑)、直近の言及も差し込む。
  //     話題から外れた訂正でも対象記憶が抽出器の視界に入るようにする。
  const correcting = hasCorrectionCue(conversationText);
  const relevantLimit = correcting ? RELEVANT_MEMORIES_CORRECTION_LIMIT : undefined;
  let relevantMemories = await retrieveRecords(
    { text: conversationText, limit: relevantLimit },
    { recallPool },
  );
  if (correcting) {
    relevantMemories = augmentWithRecent(relevantMemories, userRecords, RECENT_RECORDS_FOR_CORRECTION);
  }

  // P4(気にかけ): 想起(話題依存)では拾えない未解決ループも閉じられるよう、未解決を直接集める。
  // user 記録のみ対象(canon=provenance:'self' に openLoop は無い)。
  const openLoopRecords = userRecords.filter(
    (r) => r.memory.provenance !== 'self' && r.memory.openLoop && !r.memory.openLoop.resolvedAt,
  );

  const { episodic, semanticPatch, corrections, loopClosures } = await extractMemoryFromConversation(
    unextracted,
    relevantMemories,
    complete,
    openLoopRecords,
  );

  // 先に新記録を保存(または近似重複へマージ)して ID を得る(supersede の置換先に使う)。
  let newRecordId: string | undefined;
  if (episodic) {
    newRecordId = await saveOrMergeEpisodic(episodic, userRecords);
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
    // 主人の名前の硬いロック(主人固定・2026-06):既に主人が確定しているなら、抽出器が出した
    // userName 変更は捨てる(名前以外は素通し)。空のとき=初代主人の確定時だけ書き込める。
    const current = await getSemantic();
    if (current.userName && semanticPatch.userName && semanticPatch.userName !== current.userName) {
      log.info('owner name is locked; extraction userName change ignored'); // §6.2: 名前内容は出さない
    }
    const patch = lockOwnerName(semanticPatch, current.userName);
    if (Object.keys(patch).length > 0) await updateSemantic(patch);
  }
  // 抽出に使ったエントリへフラグを立てる(再抽出防止)。id 単位で確実に対象だけをマークする。
  await markAsExtracted(unextracted.map((e) => e.id));
}

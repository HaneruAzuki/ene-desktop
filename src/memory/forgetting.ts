import {
  EPISODIC_SCHEMA_VERSION,
  FORGET_SUMMARY_CATEGORY,
  FORGET_MONTHLY_SUMMARY_DAY,
  FORGET_MONTHLY_SUMMARY_IMPORTANCE,
  FORGET_YEARLY_SUMMARY_IMPORTANCE,
  FORGETTING_ENABLED_ENV,
} from '../shared/constants';
import { log } from '../shared/logger';
import { localIsoFromParts, nowLocalIso, todayLocalYmd } from '../shared/datetime';
import { loadAllEpisodicFiles, saveEpisodic, deleteEpisodicById } from './episodic';
import { indexEpisodic, rebuildInvertedIndex } from './index-inverted';
import { pruneVectorIndex } from './index-vector';
import { planConsolidation, type SummaryTier } from './consolidation-policy';
import { summarizePeriod, type PeriodSummary } from './summarizer';
import { saveConsolidationState } from './consolidation-state';
import type { LlmComplete } from './extractor';
import type { EpisodicMemory } from '../shared/types/memory';

// 忘却機構の orchestrator(B-13 / 設計書 §11.6)。純粋計画(consolidation-policy)を実行する:
//   期間ごとに 再要約(summarizer・LLM) → サマリ保存 → 低重要度を物理削除 → 索引整合 → state 更新。
//
// 安全設計:
//  - **要約に失敗した期間は削除しない**(サマリ無しで記憶を失わない)。
//  - 直列化ロック(inFlight)で多重実行を防ぐ。
//  - **既定オフ**(ENE_FORGETTING=1 のときだけ lifecycle が起動・破壊的処理のためレビュー後に有効化)。
//  - 物理削除(§6.4)。派生索引(inverted/vector)は削除後に再生成/掃除(真実の源は episodic 本体)。

/** 忘却機構が有効か(環境変数で明示 ON のときだけ true・安全側の既定 OFF)。 */
export function isForgettingEnabled(): boolean {
  return process.env[FORGETTING_ENABLED_ENV] === '1';
}

/** サマリの EpisodicMemory を組み立てる(専用カテゴリ・合成日アンカー・mood を動かさない valence=0)。 */
function buildSummaryMemory(
  s: PeriodSummary,
  tier: SummaryTier,
  year: number,
  month: number,
  importance: number,
  sourceCount: number,
): EpisodicMemory {
  const date =
    tier === 'monthly'
      ? localIsoFromParts(year, month, FORGET_MONTHLY_SUMMARY_DAY)
      : localIsoFromParts(year, 12, 31);
  const period = tier === 'monthly' ? `${year}-${String(month).padStart(2, '0')}` : `${year}`;
  return {
    schemaVersion: EPISODIC_SCHEMA_VERSION,
    date,
    topic: s.topic,
    summary: s.summary,
    tags: s.tags,
    entities: s.entities,
    importance,
    category: FORGET_SUMMARY_CATEGORY,
    provenance: 'user',
    valence: 0, // サマリは mood を動かさない(感情の主役は生の記憶)
    disclosureLevel: 1,
    extra: { summaryTier: tier, period, sourceCount },
  };
}

export interface ForgettingResult {
  summaries: number;
  deleted: number;
}

/**
 * 忘却機構を1回実行する(冪等:済みの期間はサマリの有無で判定しスキップ)。
 * @param now 現在のローカル年月(注入=テスト決定化)。既定は今日。
 */
export async function runForgetting(
  complete: LlmComplete,
  now: { year: number; month: number } = todayLocalYmd(),
): Promise<ForgettingResult> {
  const records = await loadAllEpisodicFiles();
  const plan = planConsolidation(records, now);
  let summaries = 0;
  let deleted = 0;

  // 月次 → 年次の順(年集合は互いに素なので順序非依存だが、若い順に処理する)。
  const jobs: Array<{ tier: SummaryTier; year: number; month: number; label: string; toSummarize: typeof records; toDelete: string[]; importance: number }> = [
    ...plan.monthly.map((m) => ({
      tier: 'monthly' as const,
      year: m.year,
      month: m.month,
      label: `${m.year}年${m.month}月`,
      toSummarize: m.toSummarize,
      toDelete: m.toDelete,
      importance: FORGET_MONTHLY_SUMMARY_IMPORTANCE,
    })),
    ...plan.yearly.map((y) => ({
      tier: 'yearly' as const,
      year: y.year,
      month: 12,
      label: `${y.year}年`,
      toSummarize: y.toSummarize,
      toDelete: y.toDelete,
      importance: FORGET_YEARLY_SUMMARY_IMPORTANCE,
    })),
  ];

  for (const job of jobs) {
    try {
      const s = await summarizePeriod(job.toSummarize, job.label, complete);
      const mem = buildSummaryMemory(s, job.tier, job.year, job.month, job.importance, job.toSummarize.length);
      const id = await saveEpisodic(mem);
      await indexEpisodic(id, mem);
      summaries++;
      // 要約できた期間だけ削除する(失敗時はここに来ない=記憶を温存)。
      for (const delId of job.toDelete) {
        await deleteEpisodicById(delId);
        deleted++;
      }
      log.info(`consolidation: ${job.tier} ${job.label} summarized (${job.toSummarize.length} → 1, deleted ${job.toDelete.length})`);
    } catch (e) {
      log.warn(`consolidation skipped (summary failed): ${job.tier} ${job.label}`, {
        name: (e as Error).name,
      });
    }
  }

  // 削除が起きたら派生索引を整合(削除分を掃除・サマリを反映)。真実の源は episodic 本体。
  if (summaries > 0 || deleted > 0) {
    try {
      await rebuildInvertedIndex();
      const remaining = await loadAllEpisodicFiles();
      await pruneVectorIndex(new Set(remaining.map((r) => r.id)));
    } catch (e) {
      log.warn('reindex after forgetting failed', { name: (e as Error).name });
    }
  }

  await saveConsolidationState({
    lastRun: nowLocalIso(),
    lastSummaryCount: summaries,
    lastDeletedCount: deleted,
  });
  return { summaries, deleted };
}

// --- バックグラウンド実行(直列化ロック) ---

let inFlight: Promise<ForgettingResult> | null = null;

/**
 * 忘却機構をバックグラウンドで1回走らせる(fire-and-forget・多重実行は直列化ロックで防止)。
 * 呼出側(lifecycle)が isForgettingEnabled() を確認してから呼ぶ。返り値はテスト用に await 可能。
 */
export function requestForgetting(complete: LlmComplete): Promise<ForgettingResult> {
  if (!inFlight) {
    inFlight = runForgetting(complete).finally(() => {
      inFlight = null;
    });
  }
  const current = inFlight;
  void current.catch((e) => log.warn('background forgetting failed', { name: (e as Error).name }));
  return current;
}

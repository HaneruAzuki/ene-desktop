import { cosineSimilarity } from '../shared/vector-math';
import {
  DAY_MS,
  EPISODIC_DEDUP_THRESHOLD,
  EPISODIC_DEDUP_MAX_AGE_DAYS,
  DAILY_LIFE_CATEGORY,
} from '../shared/constants';
import type { Embedder } from '../shared/node/embedder';
import type { EpisodicMemory, EpisodicRecord } from '../shared/types/memory';

// 書込時の近似重複マージ(P3・重複の無限蓄積を断つ)。
//
// なぜ要るか(精査 c):抽出は毎回**新規 episodic** を作るため、似た会話を繰り返すとほぼ同一の記憶が積もり、
// 想起でその塊に偏る(人間は反復経験を1つに圧縮する)。LLM の corrections は「矛盾」しか拾わず、単なる
// 反復(準重複)は素通りする。そこで保存前に**意味の近さ**で近似重複を見つけ、新規作成せず既存へマージする。
//
// 設計上の割り切り:
//  - 別個の出来事を誤って潰さないよう、しきい値は高め(保守的)。直近(MAX_AGE 日)・同カテゴリ・同 provenance のみ。
//  - daily-life(暮らしの断片・自律配信の beat)は作家が用意した素材なのでマージ対象から外す。
//  - サマリ記録(忘却の巻き上げ)も対象外。埋め込み失敗・モデル不在は null(=呼出側は新規保存に倒す)。
//  - 抽出は応答経路の外で走るため、ここでの埋め込みコストは体感に影響しない(B-01)。

/** ISO 日付から now までの経過日数。日付不明は「古い」扱い(=対象外)に倒す。 */
function ageInDays(isoDate: string, nowMs: number): number {
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return Infinity;
  return (nowMs - t) / DAY_MS;
}

export interface DedupOptions {
  threshold?: number;
  maxAgeDays?: number;
  nowMs?: number;
}

/**
 * candidate(これから保存する記憶)の近似重複を existing から探す。見つからなければ null。
 * existing は**書込可能な user-area episodic のみ**を渡すこと(canon=read-only は対象外)。
 */
export async function findNearDuplicate(
  candidate: EpisodicMemory,
  existing: EpisodicRecord[],
  embedder: Embedder,
  options: DedupOptions = {},
): Promise<EpisodicRecord | null> {
  const threshold = options.threshold ?? EPISODIC_DEDUP_THRESHOLD;
  const maxAgeDays = options.maxAgeDays ?? EPISODIC_DEDUP_MAX_AGE_DAYS;
  const nowMs = options.nowMs ?? Date.now();
  if (candidate.summary.trim().length === 0) return null;

  const prov = candidate.provenance ?? 'user';
  const pool = existing.filter(
    (r) =>
      !r.memory.supersededBy &&
      r.memory.category === candidate.category &&
      (r.memory.provenance ?? 'user') === prov &&
      r.memory.extra?.['summaryTier'] === undefined && // サマリ記録は対象外
      r.memory.category !== DAILY_LIFE_CATEGORY && // 暮らしの断片(beat)は触らない
      r.memory.summary.trim().length > 0 &&
      ageInDays(r.memory.date, nowMs) <= maxAgeDays,
  );
  if (pool.length === 0) return null;

  let vectors: number[][];
  try {
    vectors = await embedder.embed(
      [candidate.summary, ...pool.map((r) => r.memory.summary)],
      'document',
    );
  } catch {
    return null; // 埋め込み不能(モデル不在等)は判定せず新規保存に倒す
  }
  const [queryVec, ...poolVecs] = vectors;
  if (!queryVec) return null;

  let best: EpisodicRecord | null = null;
  let bestScore = -Infinity;
  poolVecs.forEach((vec, i) => {
    if (!vec || vec.length !== queryVec.length) return;
    const score = cosineSimilarity(queryVec, vec);
    if (score > bestScore) {
      bestScore = score;
      best = pool[i] ?? null;
    }
  });
  return bestScore >= threshold ? best : null;
}

/** 近似重複への非破壊マージ patch(既存 ID/日付/provenance/カテゴリは保持・情報は増やす方向のみ)。 */
export function mergeEpisodic(
  existing: EpisodicMemory,
  incoming: EpisodicMemory,
): Partial<EpisodicMemory> {
  const union = (a: string[] = [], b: string[] = []): string[] => [...new Set([...a, ...b])];
  const patch: Partial<EpisodicMemory> = {
    // より詳しい方の summary を採る(反復で詳細が増えることがある)。
    summary: incoming.summary.length > existing.summary.length ? incoming.summary : existing.summary,
    entities: union(existing.entities, incoming.entities),
    tags: union(existing.tags, incoming.tags),
    importance: Math.max(existing.importance, incoming.importance), // 反復=印象に残る→重要度は下げない
  };
  if (incoming.impression) patch.impression = incoming.impression; // 最新の受け取りで更新(P5)
  if (incoming.openLoop) patch.openLoop = incoming.openLoop; // 新しい気にかけが付いていれば引き継ぐ
  return patch;
}

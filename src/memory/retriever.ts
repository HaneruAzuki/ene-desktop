import {
  DEFAULT_RETRIEVAL_LIMIT,
  RRF_K,
  RECALL_BIAS_LAMBDA,
  RECALL_SOFTMAX_TEMP,
} from '../shared/constants';
import { log } from '../shared/logger';
import { loadRecallPool } from './recall-pool';
import { queryInverted } from './index-inverted';
import { getDefaultEmbedder, isEmbeddingModelAvailable, type Embedder } from './embedder';
import { searchVectors, syncVectorIndex } from './index-vector';
import { clampMood } from './mood';
import type { EpisodicMemory, EpisodicRecord, RetrievalQuery } from '../shared/types/memory';

// 想起エンジン(task_15 RRF ＋ task_16 心・開示ゲーティング)。
// ユーザー発言を引き金に**想起プール(user episodic ＋ canon)**を全件横断で引く(Router 非依存)。
//  - 開示ゲーティング(task_16):familiarityStage 以下の記憶のみ候補(RRF の手前でハードフィルタ)。
//  - 心(task_16):RRF スコアに λ·clampedMood·valence を加算＋softmax サンプリング(揺らぎ)。
//  - **後方互換**:deps 未指定なら従来の決定論的挙動(mood=0・全開示・argmax)。

export interface RetrieverDeps {
  /** テスト用に埋め込み実装を差し替える。未指定なら既定(ruri)。 */
  embedder?: Embedder;
  /** 心情(-2..+2 目安)。未指定=0(バイアスなし)。 */
  mood?: number;
  /** 親しさ段階(1..5)。未指定=5(全開示=従来挙動)。 */
  familiarityStage?: number;
  /** softmax サンプリング用 RNG(0..1)。未指定=決定論(スコア降順)。 */
  rng?: () => number;
}

let defaultVectorDisabled = false;

/** importance 降順 → recency(date)降順。 */
function byImportanceThenRecency(a: EpisodicMemory, b: EpisodicMemory): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  return b.date.localeCompare(a.date);
}

function passesCategory(memory: EpisodicMemory, category?: string): boolean {
  return category === undefined || memory.category === category;
}

/** 複数の順位リストを RRF で合流し id→スコアを返す。 */
function rrfFuse(rankings: string[][], k: number): Map<string, number> {
  const score = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, idx) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return score;
}

/** softmax サンプリングで上位 k 件を非復元抽出する(温度小=上位安定)。 */
function softmaxSample(
  items: Array<{ id: string; score: number }>,
  k: number,
  temp: number,
  rng: () => number,
): string[] {
  const pool = [...items];
  const out: string[] = [];
  while (out.length < k && pool.length > 0) {
    const max = Math.max(...pool.map((p) => p.score));
    const exps = pool.map((p) => Math.exp((p.score - max) / temp));
    const sum = exps.reduce((a, b) => a + b, 0);
    let r = rng() * sum;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= exps[idx] ?? 0;
      if (r <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    out.push(pool[idx]?.id ?? '');
    pool.splice(idx, 1);
  }
  return out.filter((id) => id.length > 0);
}

async function tryVectorRanking(
  text: string,
  current: EpisodicRecord[],
  byId: Map<string, EpisodicRecord>,
  limit: number,
  injected?: Embedder,
): Promise<string[]> {
  const usingDefault = !injected;
  if (usingDefault) {
    if (defaultVectorDisabled) return [];
    if (!(await isEmbeddingModelAvailable())) return [];
  }
  const embedder = injected ?? getDefaultEmbedder();
  try {
    const [queryVector] = await embedder.embed([text], 'query');
    if (!queryVector) return [];
    const index = await syncVectorIndex(current, embedder);
    if (index.entries.length === 0) return [];
    return searchVectors(queryVector, index, Math.max(limit * 4, 20))
      .map((s) => s.id)
      .filter((id) => byId.has(id));
  } catch (e) {
    log.warn(`vector recall unavailable, lexical only: ${(e as Error).name}`);
    if (usingDefault) defaultVectorDisabled = true;
    return [];
  }
}

export async function retrieveRecords(
  query: RetrievalQuery,
  deps: RetrieverDeps = {},
): Promise<EpisodicRecord[]> {
  const limit = query.limit ?? DEFAULT_RETRIEVAL_LIMIT;
  const stage = deps.familiarityStage ?? 5; // 未指定=全開示(後方互換)
  const all = await loadRecallPool();

  // current(非 superseded・category・**開示段階内**)の母集団。
  const byId = new Map<string, EpisodicRecord>();
  for (const r of all) {
    if (r.memory.supersededBy) continue;
    if (!passesCategory(r.memory, query.category)) continue;
    if ((r.memory.disclosureLevel ?? 1) > stage) continue; // 開示ゲーティング(task_16)
    byId.set(r.id, r);
  }
  const current = [...byId.values()];

  // 1) 語彙/entity ＋ 2) 意味(ベクトル)→ RRF 合流
  const lexicalRanked = (await queryInverted(query.text, query.entities))
    .map((id) => byId.get(id))
    .filter((r): r is EpisodicRecord => r !== undefined)
    .sort((a, b) => byImportanceThenRecency(a.memory, b.memory))
    .map((r) => r.id);
  const vectorRanked = await tryVectorRanking(query.text, current, byId, limit, deps.embedder);
  const rankings = vectorRanked.length > 0 ? [lexicalRanked, vectorRanked] : [lexicalRanked];
  const fused = rrfFuse(rankings, RRF_K);

  // 3) 心バイアス:finalScore = RRF + λ·clampedMood·valence(task_16)
  const clamped = clampMood(deps.mood ?? 0);
  const scored = [...fused.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, rrf]) => {
      const valence = byId.get(id)?.memory.valence ?? 0;
      return { id, score: rrf + RECALL_BIAS_LAMBDA * clamped * valence };
    });

  // 4) 上位選択:RNG ありは softmax サンプリング、なしは決定論(スコア降順)
  const orderedIds = deps.rng
    ? softmaxSample(scored, limit, RECALL_SOFTMAX_TEMP, deps.rng)
    : scored.sort((a, b) => b.score - a.score).map((s) => s.id);

  const picked: EpisodicRecord[] = [];
  const pickedIds = new Set<string>();
  for (const id of orderedIds) {
    const rec = byId.get(id);
    if (!rec) continue;
    picked.push(rec);
    pickedIds.add(id);
    if (picked.length >= limit) break;
  }

  // 5) 安全網:不足分を「直近×高importance」で補完。**user のみ**(canon は直近の出来事ではない)。
  if (picked.length < limit) {
    const rest = current
      .filter((r) => !pickedIds.has(r.id) && r.memory.provenance !== 'self')
      .sort((a, b) => byImportanceThenRecency(a.memory, b.memory));
    for (const r of rest) {
      if (picked.length >= limit) break;
      picked.push(r);
    }
  }

  return picked.slice(0, limit);
}

/** 会話時の既定想起(Conversation Layer 向け・ID は落として記憶のみ返す)。 */
export async function retrieve(
  query: RetrievalQuery,
  deps: RetrieverDeps = {},
): Promise<EpisodicMemory[]> {
  return (await retrieveRecords(query, deps)).map((r) => r.memory);
}

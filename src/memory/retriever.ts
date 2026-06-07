import { DEFAULT_RETRIEVAL_LIMIT, RRF_K } from '../shared/constants';
import { log } from '../shared/logger';
import { loadAllEpisodicFiles } from './episodic';
import { queryInverted } from './index-inverted';
import { getDefaultEmbedder, isEmbeddingModelAvailable, type Embedder } from './embedder';
import { searchVectors, syncVectorIndex } from './index-vector';
import type { EpisodicMemory, EpisodicRecord, RetrievalQuery } from '../shared/types/memory';

// 想起エンジン(design-revision-memory-v2 §1.5 / task_15)。
// ユーザー発言を引き金に全件横断で引く(Router 非依存)。
// Phase B: 語彙(tags/entity)＋意味(ベクトル)を RRF でローカル合流。
//   - ベクトル経路はモデル(ruri)が必要。未配置/失敗時は語彙のみへ自動フォールバック(§7.1)。
//   - 埋め込みは retriever 経路に集約(抽出/更新はモデルに触れない)。
//
// 設計方針:
// - category は補助フィルタ止まり(既定は全件横断・横断想起を壊さない)。
// - supersededBy を持つ古い記録は除外(current ビュー)。
// - 関連が薄くても「直近×高 importance」を少量混ぜる安全網(task_15 §5)。

export interface RetrieverDeps {
  /** テスト用に埋め込み実装を差し替える。未指定なら既定(ruri)。 */
  embedder?: Embedder;
}

// 既定 embedder でのベクトル経路が一度失敗したら、以後は試みない(毎回のロード失敗で遅くしない)。
// 注入 embedder(テスト)はこのフラグの影響を受けない。
let defaultVectorDisabled = false;

/** 新しい順に強い。importance 降順 → recency(date)降順。 */
function byImportanceThenRecency(a: EpisodicMemory, b: EpisodicMemory): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  return b.date.localeCompare(a.date);
}

function passesCategory(memory: EpisodicMemory, category?: string): boolean {
  return category === undefined || memory.category === category;
}

/** 複数の順位リストを Reciprocal Rank Fusion で合流し、id→スコアを返す。 */
function rrfFuse(rankings: string[][], k: number): Map<string, number> {
  const score = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, idx) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return score;
}

/**
 * 意味(ベクトル)ランキングを試みる。モデル未配置/失敗時は空配列(語彙のみへフォールバック)。
 * 現行記録のうち未ベクトル化・summary 変化分はここで増分埋め込みする。
 */
async function tryVectorRanking(
  text: string,
  current: EpisodicRecord[],
  byId: Map<string, EpisodicRecord>,
  limit: number,
  injected?: Embedder,
): Promise<string[]> {
  const usingDefault = !injected;
  if (usingDefault) {
    // 既定経路: 一度失敗した/モデル未配置なら、import すらせず語彙のみへ。
    if (defaultVectorDisabled) return [];
    if (!(await isEmbeddingModelAvailable())) return [];
  }
  const embedder = injected ?? getDefaultEmbedder();

  try {
    const [queryVector] = await embedder.embed([text], 'query');
    if (!queryVector) return [];
    const index = await syncVectorIndex(current, embedder);
    if (index.entries.length === 0) return [];
    // 候補は多め(limit×4)に拾い、RRF で語彙と合流させる。
    return searchVectors(queryVector, index, Math.max(limit * 4, 20))
      .map((s) => s.id)
      .filter((id) => byId.has(id));
  } catch (e) {
    // モデル未配置/ロード失敗 → 語彙のみで続行(会話を止めない)。
    log.warn(`vector recall unavailable, lexical only: ${(e as Error).name}`);
    if (usingDefault) defaultVectorDisabled = true;
    return [];
  }
}

/**
 * 想起の本体。語彙＋意味の候補を RRF 合流し、足りなければ直近×高 importance で補う。
 * 戻り値は ID 付き(更新フローが targetFile に使うため)。
 */
export async function retrieveRecords(
  query: RetrievalQuery,
  deps: RetrieverDeps = {},
): Promise<EpisodicRecord[]> {
  const limit = query.limit ?? DEFAULT_RETRIEVAL_LIMIT;
  const all = await loadAllEpisodicFiles();

  // current(非 superseded)かつ category 条件を満たす記録のみを母集団にする。
  const byId = new Map<string, EpisodicRecord>();
  for (const r of all) {
    if (!r.memory.supersededBy && passesCategory(r.memory, query.category)) byId.set(r.id, r);
  }
  const current = [...byId.values()];

  // 1) 語彙/entity 一致 → importance×recency で整列(RRF の1つ目の順位)
  const lexicalRanked = (await queryInverted(query.text, query.entities))
    .map((id) => byId.get(id))
    .filter((r): r is EpisodicRecord => r !== undefined)
    .sort((a, b) => byImportanceThenRecency(a.memory, b.memory))
    .map((r) => r.id);

  // 2) 意味(ベクトル)ランキング(使えなければ空)
  const vectorRanked = await tryVectorRanking(query.text, current, byId, limit, deps.embedder);

  // 3) RRF 合流(ベクトルが無ければ語彙のみ)
  const rankings = vectorRanked.length > 0 ? [lexicalRanked, vectorRanked] : [lexicalRanked];
  const fused = rrfFuse(rankings, RRF_K);
  const ordered = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const picked: EpisodicRecord[] = [];
  const pickedIds = new Set<string>();
  for (const id of ordered) {
    const rec = byId.get(id);
    if (!rec) continue;
    picked.push(rec);
    pickedIds.add(id);
    if (picked.length >= limit) break;
  }

  // 4) 安全網: limit に満たなければ直近×高 importance で補完
  if (picked.length < limit) {
    const rest = current
      .filter((r) => !pickedIds.has(r.id))
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

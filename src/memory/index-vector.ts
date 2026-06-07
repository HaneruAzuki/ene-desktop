import { getVectorIndexPath } from '../storage/paths';
import { readJson, writeJson } from '../storage/json-store';
import { EMBEDDING_DIM } from '../shared/constants';
import { loadAllEpisodicFiles } from './episodic';
import type { Embedder } from './embedder';
import type { EpisodicRecord } from '../shared/types/memory';

// ベクトル索引(意味検索・Phase B・design-revision-memory-v2 §1.3)。
// 派生キャッシュ＝真実の源は episodic 本体。削除しても JSON から再生成できる(§6.1 可搬性)。
// summary 変化時のみ再計算(増分)。埋め込みは Embedder を注入(テストはモック・本番は ruri)。

export interface VectorEntry {
  id: string; // episodic の相対 ID
  summary: string; // 再計算要否の判定(summary が変われば埋め直す)
  vector: number[];
}

export interface VectorIndex {
  dim: number;
  entries: VectorEntry[];
}

export interface ScoredId {
  id: string;
  score: number;
}

function emptyIndex(): VectorIndex {
  return { dim: EMBEDDING_DIM, entries: [] };
}

export async function loadVectorIndex(): Promise<VectorIndex> {
  const raw = await readJson<VectorIndex>(getVectorIndexPath());
  if (!raw || !Array.isArray(raw.entries)) return emptyIndex();
  return { dim: raw.dim ?? EMBEDDING_DIM, entries: raw.entries };
}

async function saveVectorIndex(index: VectorIndex): Promise<void> {
  await writeJson(getVectorIndexPath(), index);
}

/**
 * 与えられた現行記録について、ベクトルが無い/summary が変わったものだけ埋め直して保存する(増分)。
 * 埋め込みは retriever 経路に集約する(抽出/更新フローはモデルに触れない=モデル未配置でも動く)。
 * 戻り値は最新の索引。
 */
export async function syncVectorIndex(
  records: EpisodicRecord[],
  embedder: Embedder,
): Promise<VectorIndex> {
  const index = await loadVectorIndex();
  const byId = new Map(index.entries.map((e) => [e.id, e]));

  const need = records.filter((r) => {
    const e = byId.get(r.id);
    return !e || e.summary !== r.memory.summary; // 未登録 or summary 変化
  });
  if (need.length === 0) return index;

  const vectors = await embedder.embed(
    need.map((r) => r.memory.summary),
    'document',
  );
  need.forEach((r, i) => {
    const vector = vectors[i] ?? [];
    const existing = byId.get(r.id);
    if (existing) {
      existing.summary = r.memory.summary;
      existing.vector = vector;
    } else {
      const entry: VectorEntry = { id: r.id, summary: r.memory.summary, vector };
      index.entries.push(entry);
      byId.set(r.id, entry);
    }
  });
  await saveVectorIndex(index);
  return index;
}

/** 全 episodic から索引を作り直す(欠落時・モデル後から導入時の一括生成)。 */
export async function rebuildVectorIndex(embedder: Embedder): Promise<VectorIndex> {
  const records = await loadAllEpisodicFiles();
  const summaries = records.map((r) => r.memory.summary);
  const vectors = await embedder.embed(summaries, 'document');
  const index: VectorIndex = {
    dim: EMBEDDING_DIM,
    entries: records.map((r, i) => ({
      id: r.id,
      summary: r.memory.summary,
      vector: vectors[i] ?? [],
    })),
  };
  await saveVectorIndex(index);
  return index;
}

/** コサイン類似度(正規化済みでも安全に計算)。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** クエリベクトルに近い順に上位 topK の ID を返す。 */
export function searchVectors(
  queryVector: number[],
  index: VectorIndex,
  topK: number,
): ScoredId[] {
  return index.entries
    .map((e) => ({ id: e.id, score: cosineSimilarity(queryVector, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

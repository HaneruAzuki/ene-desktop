import { getVectorIndexPath } from '../shared/node/paths';
import { readJson, writeJson } from '../shared/node/json-store';
import { EMBEDDING_DIM } from '../shared/constants';
import { cosineSimilarity } from '../shared/vector-math';
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

// searchVectors の内部的な戻り値型(外部公開しない)。
interface ScoredId {
  id: string;
  score: number;
}

function emptyIndex(): VectorIndex {
  return { dim: EMBEDDING_DIM, entries: [] };
}

// メモリ常駐キャッシュ(段階1・D2)。索引は派生キャッシュで真実の源は episodic 本体だが、
//   想起ごとに数MBのベクトルJSONを毎回 parse していた(変化が無いターンでも)。書き手はこのモジュールだけ
//   (syncVectorIndex / pruneVectorIndex → saveVectorIndex)なので、自分の書込でキャッシュを最新化すれば
//   整合が閉じる。**パスをキー**にすることで、テストの一時ディレクトリ切替では自然に miss し(本番はパス固定で
//   ヒット)、テスト側の改変もキャッシュリセットも不要。手動編集(可搬性 §6.1)は再起動で反映。
let cache: { path: string; index: VectorIndex } | null = null;

export async function loadVectorIndex(): Promise<VectorIndex> {
  const path = getVectorIndexPath();
  if (cache && cache.path === path) return cache.index; // 常駐ヒット=毎ターンの parse を回避
  const raw = await readJson<VectorIndex>(path);
  const index =
    !raw || !Array.isArray(raw.entries)
      ? emptyIndex()
      : { dim: raw.dim ?? EMBEDDING_DIM, entries: raw.entries };
  cache = { path, index };
  return index;
}

async function saveVectorIndex(index: VectorIndex): Promise<void> {
  const path = getVectorIndexPath();
  await writeJson(path, index);
  cache = { path, index }; // 自分の書込でキャッシュを最新へ(単一書込者ゆえ整合が閉じる)
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

/**
 * 現存する ID 集合に無いベクトルエントリを索引から除去する(忘却による物理削除後の掃除)。
 * 埋め込みは不要(削るだけ)。残った記録の再埋め込みは次回 syncVectorIndex に任せる。
 */
export async function pruneVectorIndex(validIds: Set<string>): Promise<void> {
  const index = await loadVectorIndex();
  const kept = index.entries.filter((e) => validIds.has(e.id));
  if (kept.length !== index.entries.length) {
    await saveVectorIndex({ dim: index.dim, entries: kept });
  }
}

// コサイン類似度は共有実装(shared/vector-math)へ集約(E2③・二重定義の解消)。
// 後方互換のため index-vector からも再エクスポート(searchVectors の内部利用＋テストが import)。
export { cosineSimilarity };

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

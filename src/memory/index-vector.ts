import { getVectorIndexPath } from '../shared/node/paths';
import { readJson, writeJson } from '../shared/node/json-store';
import { log } from '../shared/logger';
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
  let index: VectorIndex;
  if (!raw || !Array.isArray(raw.entries)) {
    index = emptyIndex();
  } else {
    // 索引自身の dim を基準に、次元の合わないエントリ(空ベクトル []・破損・旧次元)を捨てる。
    // 捨てた分は次回 syncVectorIndex で埋め直される(自己修復)。定数ではなく索引の dim で
    // 判定するのは、テスト等で次元が異なっても正しく動くため(モデル差し替えは sync 側で検出)。
    const dim = raw.dim ?? EMBEDDING_DIM;
    const valid = raw.entries.filter((e) => Array.isArray(e.vector) && e.vector.length === dim);
    if (valid.length !== raw.entries.length) {
      log.warn(
        `vector index: dropped ${raw.entries.length - valid.length} entries with wrong/empty dim (expected ${dim})`,
      );
    }
    index = { dim, entries: valid };
  }
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
  let byId = new Map(index.entries.map((e) => [e.id, e]));

  let need = records.filter((r) => {
    const e = byId.get(r.id);
    return !e || e.summary !== r.memory.summary; // 未登録 or summary 変化
  });
  if (need.length === 0) return index;

  let vectors = await embedder.embed(
    need.map((r) => r.memory.summary),
    'document',
  );
  // 実際に得たベクトルの次元(モデルが返す次元・差し替えで変わりうる)。
  const embedDim = vectors.find((v) => v.length > 0)?.length;

  if (embedDim !== undefined && index.entries.length > 0 && embedDim !== index.dim) {
    // モデルの次元が索引と食い違う(別モデルへ差し替え等)=既存ベクトルは現クエリと幾何的に
    // 比較不能。索引を新次元で作り直し、全記録を埋め直す(rare path・自己修復)。
    log.warn(`embedding dim changed (index=${index.dim}, model=${embedDim}); rebuilding vector index`);
    index.entries.length = 0;
    byId = new Map();
    index.dim = embedDim;
    need = records;
    vectors = await embedder.embed(
      need.map((r) => r.memory.summary),
      'document',
    );
  } else if (index.entries.length === 0 && embedDim !== undefined) {
    // 空の索引は最初に格納するベクトルの実次元を採用する(定数 768 とモデル実次元のズレを吸収)。
    index.dim = embedDim;
  }

  let changed = false;
  need.forEach((r, i) => {
    const vector = vectors[i];
    // 埋め込み失敗/次元不一致は索引へ焼き込まない(空ベクトルを保存すると検索から永久に外れる)。
    // 未登録のまま残し、次回 sync(埋め込み成功時)に再挑戦させる。
    if (!vector || vector.length !== index.dim) return;
    const existing = byId.get(r.id);
    if (existing) {
      existing.summary = r.memory.summary;
      existing.vector = vector;
    } else {
      const entry: VectorEntry = { id: r.id, summary: r.memory.summary, vector };
      index.entries.push(entry);
      byId.set(r.id, entry);
    }
    changed = true;
  });
  if (changed) await saveVectorIndex(index);
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

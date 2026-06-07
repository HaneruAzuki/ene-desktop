import { getInvertedIndexPath } from '../storage/paths';
import { readJson, writeJson } from '../storage/json-store';
import { loadRecallPool } from './recall-pool';
import type { EpisodicMemory } from '../shared/types/memory';

// 逆引き索引(語彙・人物・design-revision-memory-v2 §1.3)。
// entity / keyword(tags) → 記録ID[] の写像。派生キャッシュであり、真実の源ではない
// (削除しても episodic 本体から再生成できる・§6.1 可搬性)。

export interface InvertedIndex {
  entities: Record<string, string[]>; // canonical 名 → ID[]
  keywords: Record<string, string[]>; // tag 等の語彙 → ID[]
}

function emptyIndex(): InvertedIndex {
  return { entities: {}, keywords: {} };
}

/** map[key] に id を重複なく追加する。 */
function addTo(map: Record<string, string[]>, key: string, id: string): void {
  const trimmed = key.trim();
  if (!trimmed) return;
  const list = map[trimmed] ?? (map[trimmed] = []);
  if (!list.includes(id)) list.push(id);
}

/** 1記録分を索引へ反映する(増分用・純粋関数)。 */
function addRecordToIndex(index: InvertedIndex, id: string, memory: EpisodicMemory): void {
  for (const e of memory.entities ?? []) addTo(index.entities, e, id);
  for (const t of memory.tags ?? []) addTo(index.keywords, t, id);
}

/** 想起プール(user+canon)から索引を作り直して保存する(欠落時・索引破損時の復旧)。 */
export async function rebuildInvertedIndex(): Promise<InvertedIndex> {
  const index = emptyIndex();
  for (const { id, memory } of await loadRecallPool()) {
    addRecordToIndex(index, id, memory);
  }
  await writeJson(getInvertedIndexPath(), index);
  return index;
}

/** 索引を読み込む。存在しなければ episodic から再生成する(自己修復)。 */
export async function loadInvertedIndex(): Promise<InvertedIndex> {
  const raw = await readJson<InvertedIndex>(getInvertedIndexPath());
  if (!raw) return rebuildInvertedIndex();
  // 形が壊れていても落ちないよう最小限の正規化。
  return { entities: raw.entities ?? {}, keywords: raw.keywords ?? {} };
}

/** 1記録を索引へ増分追加して保存する(保存時に呼ぶ)。 */
export async function indexEpisodic(id: string, memory: EpisodicMemory): Promise<void> {
  const index = await loadInvertedIndex();
  addRecordToIndex(index, id, memory);
  await writeJson(getInvertedIndexPath(), index);
}

/** key と needle が部分一致するか(どちらかが他方を含む・日本語の表記差・助詞付きを吸収)。 */
function looselyMatches(key: string, needle: string): boolean {
  if (!key || !needle) return false;
  return needle.includes(key) || key.includes(needle);
}

/**
 * クエリ文字列・抽出済み entities から候補記録 ID を集める。
 * - entities キー: クエリ文に含まれる / 渡された entities と緩く一致
 * - keywords キー: クエリ文に含まれる
 * 戻り値は出現順(重複排除)。
 */
export async function queryInverted(text: string, entities: string[] = []): Promise<string[]> {
  const index = await loadInvertedIndex();
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (ids: string[]): void => {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
  };

  for (const [name, ids] of Object.entries(index.entities)) {
    if (text.includes(name) || entities.some((e) => looselyMatches(name, e))) push(ids);
  }
  for (const [term, ids] of Object.entries(index.keywords)) {
    if (text.includes(term)) push(ids);
  }
  return ordered;
}

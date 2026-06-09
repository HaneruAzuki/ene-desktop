import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir } from '../storage/paths';
import { readJson, writeJson, listJsonFiles } from '../storage/json-store';
import { DEFAULT_EPISODIC_SEARCH_LIMIT, EPISODIC_SCHEMA_VERSION } from '../shared/constants';
import type { EpisodicMemory, EpisodicRecord, MemorySearchQuery } from '../shared/types/memory';

// 中期記憶(Episodic・設計書 §3.3 / §5.2 / design-revision-memory-v2)。
// 出来事・事実の要約をファイル単位で保存。ファイルパスが一意 ID を兼ねる(別フィールドを持たない)。
// 記憶の更新は supersededBy 付与による非破壊更新(物理削除しない)。

function yearOf(isoDate: string): number {
  return parseInt(isoDate.slice(0, 4), 10);
}

/** ローカルTZ込み ISO をファイル名形式へ(TZ 省略・":" を "-" に・設計書 §5.2/§5.3)。 */
function isoToFilename(iso: string): string {
  return iso.replace(/([+-]\d{2}:\d{2}|Z)$/, '').replace(/:/g, '-');
}

/**
 * 記録の一意 ID(= episodic ルートからの相対パス)を返す。
 * 例 "2026/study/2026-05-10T17-30-00.json"。
 * ファイル名単独だと year/category 跨ぎで衝突しうるため、サブディレクトリを含める。
 * 区切りは常に "/"(OS 非依存・可搬性)。
 */
export function episodicId(memory: EpisodicMemory): string {
  return `${yearOf(memory.date)}/${memory.category}/${isoToFilename(memory.date)}.json`;
}

/** 相対 ID を絶対パスへ解決する。 */
function resolveEpisodicPath(id: string): string {
  return join(getMemoryDir(), 'episodic', ...id.split('/'));
}

/**
 * 旧スキーマ(v1)読み込み時の補完(読み取り時のみ・ファイルは書き換えない)。
 * schemaVersion 欠落→1、tags 欠落→[]。後方互換のため非破壊(design-revision-memory-v2 §3)。
 */
export function migrateEpisodic(raw: EpisodicMemory): EpisodicMemory {
  return {
    ...raw,
    schemaVersion: raw.schemaVersion ?? 1,
    tags: raw.tags ?? [],
    // 心(task_16)欠落時の既定。canon は provenance:'self' を明示するので ?? で保持される。
    provenance: raw.provenance ?? 'user',
    valence: raw.valence ?? 0,
    disclosureLevel: raw.disclosureLevel ?? 1,
  };
}

/** 記録を保存し、その ID(相対パス)を返す。新規は schemaVersion を現行版に揃える。 */
export async function saveEpisodic(memory: EpisodicMemory): Promise<string> {
  const toSave: EpisodicMemory = {
    ...memory,
    schemaVersion: memory.schemaVersion ?? EPISODIC_SCHEMA_VERSION,
  };
  const id = episodicId(toSave);
  await writeJson(resolveEpisodicPath(id), toSave);
  return id;
}

/** ID から1件読み込む(マイグレーション補完済み)。存在しなければ null。 */
export async function loadEpisodicById(id: string): Promise<EpisodicMemory | null> {
  const raw = await readJson<EpisodicMemory>(resolveEpisodicPath(id));
  return raw ? migrateEpisodic(raw) : null;
}

/**
 * ID(相対パス)の記録を物理削除する(忘却機構・§11.6 / §6.4 物理削除)。
 * 存在しなくてもエラーにしない(冪等)。派生索引は呼出側で再生成/掃除する。
 */
export async function deleteEpisodicById(id: string): Promise<void> {
  await fs.rm(resolveEpisodicPath(id), { force: true });
}

/** ID の記録に patch をマージして上書きする(非破壊更新の実体・存在しなければ何もしない)。 */
export async function updateEpisodicById(
  id: string,
  patch: Partial<EpisodicMemory>,
): Promise<void> {
  const current = await loadEpisodicById(id);
  if (!current) return;
  await writeJson(resolveEpisodicPath(id), { ...current, ...patch });
}

/** 全 Episodic ファイルを ID 付きで読み込む(検索・索引の内部実装)。 */
export async function loadAllEpisodicFiles(): Promise<EpisodicRecord[]> {
  const root = join(getMemoryDir(), 'episodic');
  const out: EpisodicRecord[] = [];

  try {
    const yearDirs = await fs.readdir(root, { withFileTypes: true });
    for (const yd of yearDirs) {
      if (!yd.isDirectory()) continue;
      const catDirs = await fs.readdir(join(root, yd.name), { withFileTypes: true });
      for (const cd of catDirs) {
        if (!cd.isDirectory()) continue;
        const catPath = join(root, yd.name, cd.name);
        for (const file of await listJsonFiles(catPath)) {
          const mem = await readJson<EpisodicMemory>(join(catPath, file));
          if (mem) out.push({ id: `${yd.name}/${cd.name}/${file}`, memory: migrateEpisodic(mem) });
        }
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return out;
}

/**
 * 明示フィルタ検索(タグ/カテゴリ/重要度/年)。会話時の既定想起は retriever に移行したが、
 * 明示条件での検索用途に存続(§11.4 整合)。supersededBy を持つ古い記録は既定で除外(current ビュー)。
 */
export async function searchEpisodic(query: MemorySearchQuery): Promise<EpisodicMemory[]> {
  const all = await loadAllEpisodicFiles();
  const limit = query.limit ?? DEFAULT_EPISODIC_SEARCH_LIMIT;

  const filtered = all
    .map((r) => r.memory)
    .filter((m) => {
      if (m.supersededBy) return false; // 古い記録は current ビューから除外
      if (query.tags && query.tags.length > 0) {
        if (!query.tags.some((t) => m.tags?.includes(t))) return false;
      }
      if (query.category !== undefined && m.category !== query.category) return false;
      if (query.minImportance !== undefined && m.importance < query.minImportance) return false;
      const y = yearOf(m.date);
      if (query.yearFrom !== undefined && y < query.yearFrom) return false;
      if (query.yearTo !== undefined && y > query.yearTo) return false;
      return true;
    });

  // importance 降順(同値は元の順序を維持)
  filtered.sort((a, b) => b.importance - a.importance);
  return filtered.slice(0, limit);
}

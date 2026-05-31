import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getMemoryDir, getEpisodicDir } from '../storage/paths';
import { readJson, writeJson, listJsonFiles } from '../storage/json-store';
import { DEFAULT_EPISODIC_SEARCH_LIMIT } from '../shared/constants';
import type { EpisodicMemory, MemorySearchQuery } from '../shared/types/memory';

// 中期記憶(Episodic・設計書 §3.3 / §5.2)。出来事・事実の要約をファイル単位で保存。
// 検索は MVP 方針(全ファイル走査・タグ/カテゴリ/重要度/年でフィルタ)。
// インデックスファイルやベクトル検索は採用しない(忘却思想と整合・設計書 §3.3)。

function yearOf(isoDate: string): number {
  return parseInt(isoDate.slice(0, 4), 10);
}

/** ローカルTZ込み ISO をファイル名形式へ(TZ 省略・":" を "-" に・設計書 §5.2/§5.3)。 */
function isoToFilename(iso: string): string {
  return iso.replace(/([+-]\d{2}:\d{2}|Z)$/, '').replace(/:/g, '-');
}

export async function saveEpisodic(memory: EpisodicMemory): Promise<void> {
  const year = yearOf(memory.date);
  const dir = getEpisodicDir(year, memory.category);
  const filename = `${isoToFilename(memory.date)}.json`;
  await writeJson(join(dir, filename), memory);
}

/** 全 Episodic ファイルを読み込む(検索の内部実装。テスト容易性のため export)。 */
export async function loadAllEpisodicFiles(): Promise<EpisodicMemory[]> {
  const root = join(getMemoryDir(), 'episodic');
  const out: EpisodicMemory[] = [];

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
          if (mem) out.push(mem);
        }
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return out;
}

export async function searchEpisodic(query: MemorySearchQuery): Promise<EpisodicMemory[]> {
  const all = await loadAllEpisodicFiles();
  const limit = query.limit ?? DEFAULT_EPISODIC_SEARCH_LIMIT;

  const filtered = all.filter((m) => {
    if (query.tags && query.tags.length > 0) {
      if (!query.tags.some((t) => m.tags.includes(t))) return false;
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

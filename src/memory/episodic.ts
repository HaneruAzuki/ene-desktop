import { promises as fs } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { getMemoryDir } from '../storage/paths';
import { readJson, writeJson, listJsonFiles } from '../storage/json-store';
import { EPISODIC_SCHEMA_VERSION } from '../shared/constants';
import type { EpisodicMemory, EpisodicRecord } from '../shared/types/memory';

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

/**
 * 相対 ID を絶対パスへ解決する。
 *
 * セキュリティ:id は LLM 由来の targetFile/category を含みうる(update.ts 経由)。
 * パストラバーサル(`../` で episodic ルート外へ脱出)を厳格に拒否する。
 * 方針は src/os/validators.ts validatePath と同様(resolve→relative→境界判定)。
 *  1. 区切りで割って ".." セグメントを含むなら即拒否(`../`・`..\\` 両対応)。
 *  2. 各セグメントが絶対パス断片なら拒否(`C:\\...` や `/etc` の埋め込みを弾く)。
 *  3. 解決後に root からの相対が ".." 始まり or 絶対なら拒否(境界の最終確認)。
 * 正当な ID(例 "2026/daily/2026-05-10T....json")はそのまま通る。
 */
function resolveEpisodicPath(id: string): string {
  const root = join(getMemoryDir(), 'episodic');
  // 0. id 全体が絶対パスなら拒否。Windows では先頭 "/" 始まりも isAbsolute=true で、
  //    join するとルート配下に化けて境界チェックをすり抜けるため、ここで先に弾く
  //    ("/etc/passwd" や "C:\\..." を無効化)。
  if (isAbsolute(id)) {
    throw new Error(`不正な episodic ID(絶対パス): ${id}`);
  }
  // 区切りは "/"(可搬性のため常に "/")だが、念のため "\\" も割って検査する。
  const segments = id.split(/[\\/]/);
  for (const seg of segments) {
    // 1. ".." セグメント(脱出の主経路)を拒否。
    if (seg === '..') {
      throw new Error(`不正な episodic ID(パストラバーサル): ${id}`);
    }
    // 2. 絶対パス断片(ドライブレター埋め込み等)を拒否。
    if (isAbsolute(seg)) {
      throw new Error(`不正な episodic ID(絶対パス埋め込み): ${id}`);
    }
  }
  const resolved = join(root, ...segments);
  // 3. 解決後の境界チェック(validatePath と同手法・最終防衛線)。
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`不正な episodic ID(ルート外への脱出): ${id}`);
  }
  return resolved;
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

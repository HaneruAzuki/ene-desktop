import { promises as fs } from 'node:fs';
import { getShortTermPath } from '../storage/paths';
import { readJson, writeJson } from '../storage/json-store';
import { SHORT_TERM_MAX_ENTRIES } from '../shared/constants';
import type { ShortTermEntry } from '../shared/types/memory';

// 短期記憶(設計書 §3.3)。セッション内の直近会話を保持する。
// 逐語ログではなく、抽出済みフラグ付きの一時バッファ(終了時に削除される)。

/** overflow 時に呼ばれる抽出ハンドラ(Claude を使う抽出は呼出側が注入する)。 */
export type ShortTermOverflowHandler = () => Promise<void>;

export async function getShortTerm(): Promise<ShortTermEntry[]> {
  return (await readJson<ShortTermEntry[]>(getShortTermPath())) ?? [];
}

async function saveShortTerm(entries: ShortTermEntry[]): Promise<void> {
  await writeJson(getShortTermPath(), entries);
}

/**
 * 短期記憶にエントリを追加する。
 * 追加後 SHORT_TERM_MAX_ENTRIES を超える場合は、onOverflow(中期記憶への抽出)を
 * 呼んでから古いエントリをトリムする(設計書 §3.3)。
 */
export async function appendShortTerm(
  entry: ShortTermEntry,
  onOverflow?: ShortTermOverflowHandler,
): Promise<void> {
  const list = await getShortTerm();
  list.push(entry);
  await saveShortTerm(list);

  if (list.length > SHORT_TERM_MAX_ENTRIES) {
    // 先に未抽出エントリを中期記憶へ抽出(extracted=true 化)してからトリムする。
    if (onOverflow) {
      await onOverflow();
    }
    const after = await getShortTerm();
    if (after.length > SHORT_TERM_MAX_ENTRIES) {
      await saveShortTerm(after.slice(after.length - SHORT_TERM_MAX_ENTRIES));
    }
  }
}

/** 短期記憶ファイルを削除する(アプリ終了時・設計書 §7.2)。 */
export async function clearShortTerm(): Promise<void> {
  await fs.rm(getShortTermPath(), { force: true });
}

/** 未抽出(extracted: false)のエントリのみを返す。 */
export async function getUnextractedEntries(): Promise<ShortTermEntry[]> {
  return (await getShortTerm()).filter((e) => !e.extracted);
}

/** 指定 timestamp のエントリの extracted を true にする(重複抽出防止)。 */
export async function markAsExtracted(timestamps: string[]): Promise<void> {
  const targets = new Set(timestamps);
  const list = await getShortTerm();
  let changed = false;
  for (const e of list) {
    if (targets.has(e.timestamp) && !e.extracted) {
      e.extracted = true;
      changed = true;
    }
  }
  if (changed) {
    await saveShortTerm(list);
  }
}

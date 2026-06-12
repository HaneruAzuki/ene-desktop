import { promises as fs } from 'node:fs';
import { getShortTermPath } from '../shared/node/paths';
import { readJson, writeJson } from '../shared/node/json-store';
import { SHORT_TERM_MAX_ENTRIES } from '../shared/constants';
import type { ShortTermEntry } from '../shared/types/memory';

// 短期記憶(設計書 §3.3)。セッション内の直近会話を保持する。
// 逐語ログではなく、抽出済みフラグ付きの一時バッファ(終了時に削除される)。

export async function getShortTerm(): Promise<ShortTermEntry[]> {
  return (await readJson<ShortTermEntry[]>(getShortTermPath())) ?? [];
}

async function saveShortTerm(entries: ShortTermEntry[]): Promise<void> {
  await writeJson(getShortTermPath(), entries);
}

/**
 * 上限超過分を、古い順に「抽出済み(extracted=true)」エントリだけ取り除く(in-place)。
 * **未抽出エントリは絶対に捨てない**(中期記憶へ抽出される前に消えると記憶を失うため)。
 * 抽出をバックグラウンド化(B-01)しても、抽出が追いつくまでバッファが一時的に
 * 上限を超えるだけで、未抽出が落ちることはない(自己修復的に上限へ戻る)。
 */
function trimExtractedOverflow(list: ShortTermEntry[]): void {
  let overflow = list.length - SHORT_TERM_MAX_ENTRIES;
  for (let i = 0; i < list.length && overflow > 0; ) {
    if (list[i]?.extracted) {
      list.splice(i, 1);
      overflow--;
    } else {
      i++;
    }
  }
}

/**
 * 短期記憶にエントリを追加する。
 * 追加後 SHORT_TERM_MAX_ENTRIES を超える場合は、抽出済みの古いエントリのみトリムする
 * (設計書 §3.3)。中期記憶への抽出は呼出側がバックグラウンドで行う(B-01・extraction-scheduler)。
 */
export async function appendShortTerm(entry: ShortTermEntry): Promise<void> {
  const list = await getShortTerm();
  list.push(entry);
  if (list.length > SHORT_TERM_MAX_ENTRIES) {
    trimExtractedOverflow(list);
  }
  await saveShortTerm(list);
}

/**
 * 最新の assistant エントリのテキストを置き換える(barge-in で「聞かせた分」へ切り詰める・Phase B)。
 * 末尾から最初の assistant を探して text を差し替える。assistant が無ければ何もしない。
 * **抽出済み(extracted=true)なら触らない**(既に中期記憶へ移った内容を後から改変しない・安全側)。
 */
export async function replaceLastAssistantText(text: string): Promise<void> {
  const list = await getShortTerm();
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e && e.role === 'assistant') {
      if (e.extracted || e.text === text) return; // 抽出済み/変化なしは何もしない
      e.text = text;
      await saveShortTerm(list);
      return;
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

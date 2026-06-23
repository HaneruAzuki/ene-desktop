import { DAY_MS, OPEN_LOOP_LOOKBACK_DAYS, OPEN_LOOP_SURFACE_MAX } from '../shared/constants';
import { getOpenLoopStatePath } from '../shared/node/paths';
import { readJson, writeJson } from '../shared/node/json-store';
import { loadEpisodicById, updateEpisodicById } from './episodic';
import type { EpisodicRecord } from '../shared/types/memory';

// 気にかけエンジン(P4・open loops・N-PRES-4 / ⑦再設計 2026-06-24)。
//
// 想起(retriever)は「話題に関連する記憶」を引くが、気にかけは話題に関係なく「結末が出ていない事柄」を
// 持ち出すための別経路。設計は「1回は素直に＋2回目以降は関連トピックで」:
//  - 能動提示(selectOpenLoops): 未解決の open loop を、**まだ能動提示していないものだけ**、新しい順に最大 N 件。
//    提示したら id を surfaced 集合に記録し、以後は自分から蒸し返さない(人間の自然な引き際)。
//  - 関連トピック再質問(2回目以降): 同じ loop が会話の話題に関連して想起(retriever)で再浮上したら、
//    prompt-builder が「まだ結末を聞いていない」ヒントを添える=相手がその話題に触れた今なら自然に尋ねられる。
//  - 解決(resolveOpenLoop): 結末が出た loop に resolvedAt を立て、以後の探索から外す(非破壊更新)。
//  - 開示ゲート(§1.5): 親密度(stage)より深い気にかけは能動提示しない。
//
// ※ 旧実装の {at, count} ＋ per-loop クールダウン(OPEN_LOOP_COOLDOWN_DAYS / MAX_SURFACES)は、1ショット運用に
//   対して過剰(到達不能な分岐)だったため撤去し、「能動提示済み id の集合」へ簡素化した。

/** 気にかけ注入の履歴(派生状態・真実の源は episodic 本体の openLoop)。 */
export interface OpenLoopState {
  /** これまで「自分から」能動提示した loop の id(=相対パス)。一度提示したら以後は能動提示しない。 */
  surfaced: string[];
  /** 会話経路が「気にかけ」を最後に提示した日時(全体頻度を OPEN_LOOP_GLOBAL_COOLDOWN_HOURS で間引く・⑥)。 */
  lastOpenLoopAt?: string;
  /** 会話経路が「まだ知らないこと」(knowledge-gaps)を最後に提示した日時(open-loop とは独立・⑥)。 */
  lastGapAt?: string;
}

export interface OpenLoopSelection {
  /** 揮発コンテキストへ載せる覚書(openLoop.note)。最大 OPEN_LOOP_SURFACE_MAX 件。 */
  notes: string[];
  /** 今回の能動提示分を加えた更新後の surfaced(呼出側が保存する)。 */
  surfaced: string[];
}

/**
 * 能動提示する未解決の気にかけを選ぶ(純粋)。新しい順・最大 OPEN_LOOP_SURFACE_MAX 件。
 *  - resolvedAt が立っている=閉じた → 除外。
 *  - date が OPEN_LOOP_LOOKBACK_DAYS より古い → 掘り起こさない(日付不明は保守的に残す)。
 *  - 既に能動提示済み(surfaced に id あり) → もう自分からは出さない(関連話題は想起経路で再訪)。
 *  - 親密度(stage)より深い(disclosureLevel > stage) → まだ持ち出さない(§1.5・未指定=全開示)。
 * 戻り値の surfaced には、今回選んだ id を加えて返す。
 */
export function selectOpenLoops(
  records: EpisodicRecord[],
  state: OpenLoopState,
  nowMs: number,
  stage: number = 5,
): OpenLoopSelection {
  const lookbackMs = OPEN_LOOP_LOOKBACK_DAYS * DAY_MS;
  const already = new Set(state.surfaced);

  const candidates = records
    .filter((r) => {
      const ol = r.memory.openLoop;
      if (!ol || ol.resolvedAt) return false;
      if ((r.memory.disclosureLevel ?? 1) > stage) return false;
      const ts = Date.parse(r.memory.date);
      if (!Number.isNaN(ts) && nowMs - ts > lookbackMs) return false; // 古すぎる未解決は掘らない
      if (already.has(r.id)) return false; // 能動提示済み=休眠(関連話題で想起されれば prompt 側で再質問)
      return true;
    })
    .sort((a, b) => b.memory.date.localeCompare(a.memory.date))
    .slice(0, OPEN_LOOP_SURFACE_MAX);

  const surfaced = [...state.surfaced, ...candidates.map((r) => r.id)];
  const notes = candidates.map((r) => r.memory.openLoop?.note ?? '').filter((n) => n.length > 0);
  return { notes, surfaced };
}

/** 抽出器に「現在の未解決の気にかけ」を見せる文面(結末が出たら loopClosures で閉じてもらう)。 */
export function formatOpenLoopsForExtractor(records: EpisodicRecord[]): string {
  const open = records.filter((r) => r.memory.openLoop && !r.memory.openLoop.resolvedAt);
  if (open.length === 0) return '';
  const lines = open.map((r) => `- id: ${r.id}\n  気にかけ: ${r.memory.openLoop?.note ?? ''}`);
  return ['', '現在「気にかけている」未解決の事柄(結末が会話に出たら loopClosures で id を閉じる):', ...lines].join(
    '\n',
  );
}

// --- 状態の I/O(派生状態・壊れても会話に影響させない) ---

export async function loadOpenLoopState(): Promise<OpenLoopState> {
  const raw = await readJson<{ surfaced?: unknown; lastOpenLoopAt?: unknown; lastGapAt?: unknown }>(
    getOpenLoopStatePath(),
  );
  const state: OpenLoopState = { surfaced: normalizeSurfaced(raw?.surfaced) };
  if (raw && typeof raw.lastOpenLoopAt === 'string') state.lastOpenLoopAt = raw.lastOpenLoopAt;
  if (raw && typeof raw.lastGapAt === 'string') state.lastGapAt = raw.lastGapAt;
  return state;
}

/**
 * surfaced を id 配列へ寛容に正規化する。
 * 旧形式(id→ISO文字列 / id→{at,count} の Record)は**キー(id)だけ**拾う(「能動提示済み」の意味は保たれる)。
 */
function normalizeSurfaced(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (raw && typeof raw === 'object') return Object.keys(raw as Record<string, unknown>);
  return [];
}

export async function saveOpenLoopState(state: OpenLoopState): Promise<void> {
  // lastOpenLoopAt / lastGapAt 未指定の保存(idle-talk/挨拶は surfaced のみ更新)では、既存の間引き
  // タイムスタンプを保持する=別経路の保存で会話経路のクールダウンを消さない(⑥・共有 state の取り違え防止)。
  let toSave = state;
  if (state.lastOpenLoopAt === undefined || state.lastGapAt === undefined) {
    const raw = await readJson<{ lastOpenLoopAt?: unknown; lastGapAt?: unknown }>(
      getOpenLoopStatePath(),
    );
    const merged: OpenLoopState = { ...state };
    if (merged.lastOpenLoopAt === undefined && raw && typeof raw.lastOpenLoopAt === 'string')
      merged.lastOpenLoopAt = raw.lastOpenLoopAt;
    if (merged.lastGapAt === undefined && raw && typeof raw.lastGapAt === 'string')
      merged.lastGapAt = raw.lastGapAt;
    toSave = merged;
  }
  await writeJson(getOpenLoopStatePath(), toSave);
}

/**
 * 気にかけを解決済みにする(結末が出た loop に resolvedAt を立てる・非破壊更新)。
 * 既に解決済み/対象なしは何もしない。targetFile は LLM 由来でも episodic.ts が境界検査する。
 */
export async function resolveOpenLoop(id: string, resolvedAt: string): Promise<void> {
  const current = await loadEpisodicById(id);
  if (!current?.openLoop || current.openLoop.resolvedAt) return;
  await updateEpisodicById(id, { openLoop: { ...current.openLoop, resolvedAt } });
}

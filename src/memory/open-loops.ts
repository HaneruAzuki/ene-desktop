import {
  DAY_MS,
  OPEN_LOOP_LOOKBACK_DAYS,
  OPEN_LOOP_SURFACE_MAX,
  OPEN_LOOP_COOLDOWN_DAYS,
  OPEN_LOOP_MAX_SURFACES,
} from '../shared/constants';
import { getOpenLoopStatePath } from '../shared/node/paths';
import { readJson, writeJson } from '../shared/node/json-store';
import { loadEpisodicById, updateEpisodicById } from './episodic';
import type { EpisodicRecord } from '../shared/types/memory';

// 気にかけエンジン(P4・open loops・N-PRES-4)。
//
// 想起(retriever)は「話題に関連する記憶」を引くが、気にかけは話題に関係なく
// 「結末が出ていない事柄」を話の切れ目で自発的に持ち出すための別経路。
//  - 選択(selectOpenLoops): 未解決・期間内・上限未到達・クールダウン外の open loop を最大 N 件、新しい順に選ぶ(純粋)。
//  - 上限(OPEN_LOOP_MAX_SURFACES): 自分から持ち出してよい回数の上限。到達=休眠(もう蒸し返さない・しつこさ防止)。
//    既定 1=「一度聞いて答えが無ければ引く」。関連話題が出れば retriever 経路で自然に再訪できる(別経路)。
//  - クールダウン(open-loop-state.json): 上限が 2 以上のとき、複数回の注入を OPEN_LOOP_COOLDOWN_DAYS だけ空ける。
//  - 解決(resolveOpenLoop): 結末が判明した loop に resolvedAt を立て、以後の探索から外す(非破壊更新)。

/** 1件の気にかけの注入履歴(回数＋最後に注入した日時)。 */
export interface OpenLoopSurface {
  /** 最後に注入した日時(ローカルTZ込み ISO 8601)。 */
  at: string;
  /** これまでに「自分から」注入した累計回数(上限 OPEN_LOOP_MAX_SURFACES で休眠)。 */
  count: number;
}

/** 気にかけ注入の履歴記録(派生状態・真実の源は episodic 本体の openLoop)。 */
export interface OpenLoopState {
  /** loop の id(= episodic 相対パス)→ 注入履歴。 */
  surfaced: Record<string, OpenLoopSurface>;
}

export interface OpenLoopSelection {
  /** 揮発コンテキストへ載せる覚書(openLoop.note)。最大 OPEN_LOOP_SURFACE_MAX 件。 */
  notes: string[];
  /** 注入分を記録した更新後の state(呼出側が保存する)。 */
  surfaced: Record<string, OpenLoopSurface>;
}

/**
 * 未解決の気にかけを選ぶ(純粋)。新しい順・最大 OPEN_LOOP_SURFACE_MAX 件。
 *  - resolvedAt が立っている = 閉じた → 除外。
 *  - date が OPEN_LOOP_LOOKBACK_DAYS より古い = 掘り起こさない(日付不明は保守的に残す)。
 *  - 注入回数が OPEN_LOOP_MAX_SURFACES に達している = 休眠 → 除外(「一度聞いたら引く」)。
 *  - 上限未到達でも直近 OPEN_LOOP_COOLDOWN_DAYS 以内に注入済み = クールダウン中 → 除外。
 * 戻り値の surfaced には、今回選んだ loop の at を nowIso に、count を +1 して返す。
 */
export function selectOpenLoops(
  records: EpisodicRecord[],
  state: OpenLoopState,
  nowMs: number,
  nowIso: string,
): OpenLoopSelection {
  const lookbackMs = OPEN_LOOP_LOOKBACK_DAYS * DAY_MS;
  const cooldownMs = OPEN_LOOP_COOLDOWN_DAYS * DAY_MS;

  const candidates = records
    .filter((r) => {
      const ol = r.memory.openLoop;
      if (!ol || ol.resolvedAt) return false;
      const ts = Date.parse(r.memory.date);
      if (!Number.isNaN(ts) && nowMs - ts > lookbackMs) return false; // 古すぎる未解決は掘らない
      const prev = state.surfaced[r.id];
      if (prev) {
        if (prev.count >= OPEN_LOOP_MAX_SURFACES) return false; // 上限到達=休眠(もう自分からは出さない)
        const lastMs = Date.parse(prev.at);
        if (!Number.isNaN(lastMs) && nowMs - lastMs < cooldownMs) return false; // クールダウン中
      }
      return true;
    })
    .sort((a, b) => b.memory.date.localeCompare(a.memory.date))
    .slice(0, OPEN_LOOP_SURFACE_MAX);

  const surfaced = { ...state.surfaced };
  for (const r of candidates) {
    surfaced[r.id] = { at: nowIso, count: (state.surfaced[r.id]?.count ?? 0) + 1 };
  }
  const notes = candidates
    .map((r) => r.memory.openLoop?.note ?? '')
    .filter((n) => n.length > 0);
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

// --- クールダウン状態の I/O(派生状態・壊れても会話に影響させない) ---

export async function loadOpenLoopState(): Promise<OpenLoopState> {
  const raw = await readJson<{ surfaced?: Record<string, unknown> }>(getOpenLoopStatePath());
  if (raw && typeof raw === 'object' && raw.surfaced && typeof raw.surfaced === 'object') {
    return { surfaced: normalizeSurfaced(raw.surfaced) };
  }
  return { surfaced: {} };
}

/**
 * 旧形式(id→ISO文字列・回数概念なし)を新形式({at, count})へ寛容に変換する。
 * 旧記録は「1回注入済み」とみなす(count=1)=既定の上限(1)では即休眠になり、過去の気にかけを蒸し返さない。
 */
function normalizeSurfaced(raw: Record<string, unknown>): Record<string, OpenLoopSurface> {
  const out: Record<string, OpenLoopSurface> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      out[id] = { at: v, count: 1 };
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const at = typeof o.at === 'string' ? o.at : '';
      const count = typeof o.count === 'number' && o.count > 0 ? Math.floor(o.count) : 1;
      out[id] = { at, count };
    }
  }
  return out;
}

export async function saveOpenLoopState(state: OpenLoopState): Promise<void> {
  await writeJson(getOpenLoopStatePath(), state);
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

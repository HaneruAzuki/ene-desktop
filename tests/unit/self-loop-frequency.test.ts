import { describe, it, expect } from 'vitest';
import { selectOpenLoops, type OpenLoopState } from '../../src/memory/open-loops';
import {
  SELF_LOOP_COOLDOWN_HOURS,
  OPEN_LOOP_GLOBAL_COOLDOWN_HOURS,
  OPEN_LOOP_LOOKBACK_DAYS,
  DAY_MS,
} from '../../src/shared/constants';
import type { EpisodicRecord, OpenLoop } from '../../src/shared/types/memory';

// 「意思と不安のにじみ」(案1)の実効頻度の回帰ガード。
// トリミ自身の気がかり(self open loop)は三重に律速される:
//   ① SELF_LOOP_COOLDOWN_HOURS(会話経路で連発しない) ② 1ショット surfaced(同じ気がかりは自分から一度だけ)
//   ③ 週次供給(off-screen パックが openLoop を持つ beat を吸収する頻度・authored 2四半期で ≈9件)。
// これらが掛かって「実質ゼロ回=機能が死ぬ」ことがないのを、authored 供給に近い決定論シミュレーションで守る。
// (将来クールダウンを過大にする等でサイレントに死ぬのを検知する。純粋関数 selectOpenLoops のみに依存。)

const HOUR_MS = DAY_MS / 24;
const START = Date.parse('2026-07-06T09:00:00+09:00');

function worry(id: string, prov: 'user' | 'self', dayOffset: number, note: string): EpisodicRecord {
  const ol: OpenLoop = { kind: 'question', note };
  return {
    id,
    memory: {
      date: new Date(START + dayOffset * DAY_MS).toISOString(),
      topic: 't',
      summary: note,
      importance: 3,
      category: 'daily-life',
      provenance: prov,
      disclosureLevel: 1,
      openLoop: ol,
    },
  };
}

// authored 2四半期に相当する self worry 供給(実パック W28/30/32/36/39 ＋ Q4 の間隔を写像・≈3-4週に1件)。
const SELF_WORRIES = [0, 14, 28, 56, 77, 105, 168].map((d, i) => worry(`s${i}`, 'self', d, `self worry ${i}`));
// 相手の気にかけ(別クールダウン=6h)。self と食い合わないことも同時に確認する。
const USER_WORRIES = [3, 40, 120].map((d, i) => worry(`u${i}`, 'user', d, `user worry ${i}`));

describe('self worry の実効頻度(三重律速で機能が死なない・案1)', () => {
  it('180日・現実的な会話ペースで、供給した self worry が全件一度ずつ表面化する', () => {
    let state: OpenLoopState = { surfaced: [] };
    const cooled = (last: string | undefined, hours: number, nowMs: number): boolean => {
      const t = last ? Date.parse(last) : NaN;
      return Number.isNaN(t) || nowMs - t >= hours * HOUR_MS;
    };
    const surfacedSelf = new Set<string>();
    const surfacedUser = new Set<string>();
    let selfEvents = 0;

    for (let day = 0; day < 180; day++) {
      for (let k = 0; k < 4; k++) {
        // 1日4ターン(≈9,12,15,18時)
        const nowMs = START + day * DAY_MS + k * 3 * HOUR_MS;
        const nowIso = new Date(nowMs).toISOString();
        // 週次供給の模擬: その時点までに吸収済み(date<=now)の worry だけがプールに入る。
        const pool = [...SELF_WORRIES, ...USER_WORRIES].filter((r) => Date.parse(r.memory.date) <= nowMs);
        const includeUser = cooled(state.lastOpenLoopAt, OPEN_LOOP_GLOBAL_COOLDOWN_HOURS, nowMs);
        const includeSelf = cooled(state.lastSelfLoopAt, SELF_LOOP_COOLDOWN_HOURS, nowMs);
        if (!includeUser && !includeSelf) continue;
        const sel = selectOpenLoops(pool, state, nowMs, 5, { user: includeUser, self: includeSelf });
        const next: OpenLoopState = {
          surfaced: sel.surfaced,
          ...(state.lastOpenLoopAt ? { lastOpenLoopAt: state.lastOpenLoopAt } : {}),
          ...(state.lastSelfLoopAt ? { lastSelfLoopAt: state.lastSelfLoopAt } : {}),
        };
        if (sel.notes.length > 0) {
          next.lastOpenLoopAt = nowIso;
          for (const id of sel.surfaced) if (id.startsWith('u')) surfacedUser.add(id);
        }
        if (sel.selfNotes.length > 0) {
          next.lastSelfLoopAt = nowIso;
          selfEvents += 1;
          for (const id of sel.surfaced) if (id.startsWith('s')) surfacedSelf.add(id);
        }
        state = next;
      }
    }

    // ① 死んでいない: 供給した self worry の全件が一度は表面化する(lookback 内に会話がある通常利用)。
    expect(surfacedSelf.size).toBe(SELF_WORRIES.length);
    // ② 乱発でもない: 表面化イベントは供給件数と同オーダー(48h クールダウンが暴走を抑える)。
    expect(selfEvents).toBeLessThanOrEqual(SELF_WORRIES.length + 1);
    // ③ 相手の気にかけを食わない: 別クールダウンで user worry も全件表面化する。
    expect(surfacedUser.size).toBe(USER_WORRIES.length);
  });

  it('クールダウン(48h)は供給間隔(≈3-4週)よりずっと短い=供給が律速でありクールダウンが機能を殺さない', () => {
    // 平均供給間隔(日) ＞ クールダウン(日) を静的に確認(定数変更時の早期警告)。
    const spanDays = 168; // 最初と最後の worry の間隔
    const avgSupplyIntervalDays = spanDays / (SELF_WORRIES.length - 1);
    expect(SELF_LOOP_COOLDOWN_HOURS / 24).toBeLessThan(avgSupplyIntervalDays);
    // lookback は供給間隔より十分長い=通常利用なら吸収から表面化までに会話機会がある。
    expect(OPEN_LOOP_LOOKBACK_DAYS).toBeGreaterThan(avgSupplyIntervalDays);
  });
});

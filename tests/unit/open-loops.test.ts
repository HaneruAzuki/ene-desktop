import { describe, it, expect } from 'vitest';
import { selectOpenLoops, type OpenLoopState } from '../../src/memory/open-loops';
import {
  DAY_MS,
  OPEN_LOOP_LOOKBACK_DAYS,
  OPEN_LOOP_COOLDOWN_DAYS,
  OPEN_LOOP_SURFACE_MAX,
  OPEN_LOOP_MAX_SURFACES,
} from '../../src/shared/constants';
import type { EpisodicRecord, OpenLoop } from '../../src/shared/types/memory';

// P4: 気にかけ(open loop)の選択ロジック。時間調整した記憶でクールダウン/期間/解決済みを検証する。

const NOW_MS = Date.parse('2026-06-13T12:00:00+09:00');
const NOW_ISO = '2026-06-13T12:00:00+09:00';

/** nowMs から daysAgo 日前の ISO 日付。 */
function daysAgoIso(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

function rec(id: string, daysAgo: number, openLoop: OpenLoop | undefined): EpisodicRecord {
  return {
    id,
    memory: {
      date: daysAgoIso(daysAgo),
      topic: 't',
      summary: 's',
      importance: 3,
      category: 'general',
      provenance: 'user',
      ...(openLoop ? { openLoop } : {}),
    },
  };
}

const empty: OpenLoopState = { surfaced: {} };

describe('selectOpenLoops (P4)', () => {
  it('未解決の open loop を新しい順に最大件数まで選ぶ', () => {
    const records = [
      rec('a', 1, { kind: 'user-event', note: '面接の結果待ち' }),
      rec('b', 2, { kind: 'question', note: '名前の読みを聞きそびれた' }),
      rec('c', 3, { kind: 'promise-by-me', note: '今度教えると約束した' }),
    ];
    const sel = selectOpenLoops(records, empty, NOW_MS, NOW_ISO);
    expect(sel.notes.length).toBe(Math.min(3, OPEN_LOOP_SURFACE_MAX));
    expect(sel.notes[0]).toBe('面接の結果待ち'); // 最新が先頭
  });

  it('open loop の無い記録・解決済みは選ばない', () => {
    const records = [
      rec('a', 1, undefined),
      rec('b', 1, { kind: 'user-event', note: '解決済み', resolvedAt: NOW_ISO }),
    ];
    expect(selectOpenLoops(records, empty, NOW_MS, NOW_ISO).notes).toEqual([]);
  });

  it('期間(lookback)より古い未解決は掘り起こさない', () => {
    const old = rec('a', OPEN_LOOP_LOOKBACK_DAYS + 5, { kind: 'user-event', note: '大昔の件' });
    expect(selectOpenLoops([old], empty, NOW_MS, NOW_ISO).notes).toEqual([]);
  });

  it('未注入なら出して、surfaced に注入回数(count=1)と日時を記録する', () => {
    const records = [rec('a', 1, { kind: 'user-event', note: '面接の結果待ち' })];
    const sel = selectOpenLoops(records, empty, NOW_MS, NOW_ISO);
    expect(sel.notes).toEqual(['面接の結果待ち']);
    // 注入したら surfaced を now＋回数で更新する。
    expect(sel.surfaced.a).toEqual({ at: NOW_ISO, count: 1 });
  });

  it('上限(OPEN_LOOP_MAX_SURFACES)に達した気にかけは、もう自分からは持ち出さない(一度聞いたら引く)', () => {
    const records = [rec('a', 1, { kind: 'user-event', note: '面接の結果待ち' })];
    // 既に上限まで注入済み。クールダウンを過ぎていても(=以前なら再注入していた)出さない=休眠。
    const exhausted: OpenLoopState = {
      surfaced: {
        a: { at: new Date(NOW_MS - (OPEN_LOOP_COOLDOWN_DAYS + 1) * DAY_MS).toISOString(), count: OPEN_LOOP_MAX_SURFACES },
      },
    };
    expect(selectOpenLoops(records, exhausted, NOW_MS, NOW_ISO).notes).toEqual([]);
  });
});

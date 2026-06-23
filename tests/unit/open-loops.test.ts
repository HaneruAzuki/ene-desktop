import { describe, it, expect } from 'vitest';
import { selectOpenLoops, type OpenLoopState } from '../../src/memory/open-loops';
import { DAY_MS, OPEN_LOOP_LOOKBACK_DAYS, OPEN_LOOP_SURFACE_MAX } from '../../src/shared/constants';
import type { EpisodicRecord, OpenLoop } from '../../src/shared/types/memory';

// P4/⑦: 気にかけ(open loop)の能動提示ロジック。期間/解決済み/「能動提示は1つの loop につき1回だけ」を検証する。

const NOW_MS = Date.parse('2026-06-13T12:00:00+09:00');

/** NOW_MS から daysAgo 日前の ISO 日付。 */
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

const empty: OpenLoopState = { surfaced: [] };

describe('selectOpenLoops (P4/⑦)', () => {
  it('未解決の open loop を新しい順に最大件数まで選ぶ', () => {
    const records = [
      rec('a', 1, { kind: 'user-event', note: '面接の結果待ち' }),
      rec('b', 2, { kind: 'question', note: '名前の読みを聞きそびれた' }),
      rec('c', 3, { kind: 'promise-by-me', note: '今度教えると約束した' }),
    ];
    const sel = selectOpenLoops(records, empty, NOW_MS);
    expect(sel.notes.length).toBe(Math.min(3, OPEN_LOOP_SURFACE_MAX));
    expect(sel.notes[0]).toBe('面接の結果待ち'); // 最新が先頭
  });

  it('open loop の無い記録・解決済みは選ばない', () => {
    const records = [
      rec('a', 1, undefined),
      rec('b', 1, { kind: 'user-event', note: '解決済み', resolvedAt: daysAgoIso(0) }),
    ];
    expect(selectOpenLoops(records, empty, NOW_MS).notes).toEqual([]);
  });

  it('期間(lookback)より古い未解決は掘り起こさない', () => {
    const old = rec('a', OPEN_LOOP_LOOKBACK_DAYS + 5, { kind: 'user-event', note: '大昔の件' });
    expect(selectOpenLoops([old], empty, NOW_MS).notes).toEqual([]);
  });

  it('能動提示したら surfaced に id を記録する', () => {
    const records = [rec('a', 1, { kind: 'user-event', note: '面接の結果待ち' })];
    const sel = selectOpenLoops(records, empty, NOW_MS);
    expect(sel.notes).toEqual(['面接の結果待ち']);
    expect(sel.surfaced).toContain('a');
  });

  it('既に能動提示済み(surfaced に id あり)なら、もう自分からは持ち出さない(1回素直に・以降は話題トリガ)', () => {
    const records = [rec('a', 1, { kind: 'user-event', note: '面接の結果待ち' })];
    const surfacedState: OpenLoopState = { surfaced: ['a'] };
    expect(selectOpenLoops(records, surfacedState, NOW_MS).notes).toEqual([]);
  });
});

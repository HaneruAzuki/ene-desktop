import { describe, it, expect } from 'vitest';
import {
  selectWeeklyBeat,
  beatToEpisodic,
  DEFAULT_GRACE_WEEKS,
} from '../../src/memory/offscreen-life-select';
import { isoWeekParts } from '../../src/shared/datetime';
import type { OffscreenBeat, OffscreenLifePack } from '../../src/shared/types/offscreen-life';

// 画面の外の暮らし: 週次選択・beat→episodic 変換・ISO週の純粋ロジック(I/O なし=決定論)。

function seasonal(weeks: string[]): OffscreenLifePack {
  return {
    packVersion: 'test-seasonal',
    season: 'summer',
    kind: 'seasonal',
    arcs: [],
    beats: weeks.map((w) => ({ id: `b-${w}`, arcId: 'a', week: w, topic: 't', summary: 's' })),
  };
}

function evergreen(weekNums: number[]): OffscreenLifePack {
  return {
    packVersion: 'test-evergreen',
    season: 'year',
    kind: 'evergreen',
    arcs: [],
    beats: weekNums.map((n) => ({ id: `ev-${n}`, arcId: 'a', week: n, topic: 't', summary: 's' })),
  };
}

// W27..W39 を持つ季節パック(夏Q3 相当)。
const SUMMER = seasonal(['2026-W27', '2026-W30', '2026-W33', '2026-W36', '2026-W39']);
const EVERGREEN = evergreen([2, 27, 33, 41, 52]);

describe('selectWeeklyBeat (off-screen-life フォールバック §12)', () => {
  it('① 今週ぶんの authored beat があればそれを使う', () => {
    const sel = selectWeeklyBeat([SUMMER, EVERGREEN], '2026-W30', 30);
    expect(sel).not.toBeNull();
    expect(sel!.source).toBe('authored');
    expect(sel!.beat.week).toBe('2026-W30');
  });

  it('② 今週ぶんが無いが最新の authored が猶予内 → 保持(null・常緑に行かない)', () => {
    // 最新 W39、今週 W41(gap 2 ≤ 26)。
    const sel = selectWeeklyBeat([SUMMER, EVERGREEN], '2026-W41', 41);
    expect(sel).toBeNull();
  });

  it('③ 最新の authored が猶予超 → 常緑年を週-of-year で', () => {
    const oldSeasonal = seasonal(['2025-W39']); // 1年以上前
    const sel = selectWeeklyBeat([oldSeasonal, EVERGREEN], '2026-W41', 41);
    expect(sel).not.toBeNull();
    expect(sel!.source).toBe('evergreen');
    expect(sel!.beat.week).toBe(41);
  });

  it('③ 常緑: 当該週ぴったりが無ければ「以前で最大」を選ぶ', () => {
    const sel = selectWeeklyBeat([evergreen([2, 27, 33, 52])], '9999-W35', 35);
    expect(sel!.source).toBe('evergreen');
    expect(sel!.beat.week).toBe(33); // 35 以前で最大
  });

  it('③ 常緑: 当該週が先頭より前ならラップして年内最大を選ぶ', () => {
    const sel = selectWeeklyBeat([evergreen([10, 33, 52])], '9999-W05', 5);
    expect(sel!.source).toBe('evergreen');
    expect(sel!.beat.week).toBe(52); // 5 以前が無い→年内最大へラップ
  });

  it('④ seasonal も evergreen も無ければ null(quiet)', () => {
    expect(selectWeeklyBeat([], '2026-W30', 30)).toBeNull();
  });

  it('④ 猶予超で常緑も無ければ null(quiet)', () => {
    const oldSeasonal = seasonal(['2020-W10']);
    expect(selectWeeklyBeat([oldSeasonal], '2026-W30', 30)).toBeNull();
  });

  it('猶予の境界: ちょうど猶予内は保持、1週超で常緑へ', () => {
    const old = seasonal(['2026-W01']);
    // gap = 1+DEFAULT_GRACE_WEEKS の週(=境界超)で常緑へ。
    const justOver = `2026-W${String(1 + DEFAULT_GRACE_WEEKS + 1).padStart(2, '0')}`;
    const sel = selectWeeklyBeat([old, evergreen([20])], justOver, 28);
    expect(sel!.source).toBe('evergreen');
  });
});

describe('beatToEpisodic', () => {
  it('全フィールドを写し、provenance は self、summary は上限で切る', () => {
    const beat: OffscreenBeat = {
      id: 'b1',
      arcId: 'a',
      week: '2026-W33',
      topic: '誕生日',
      summary: 'あ'.repeat(300),
      tags: ['誕生日'],
      entities: ['母'],
      valence: 2,
      importance: 3,
      category: 'daily-life',
      disclosureLevel: 2,
      openLoop: { kind: 'question', note: 'まだ続く' },
    };
    const mem = beatToEpisodic(beat, '2026-08-15T19:40:00+09:00');
    expect(mem.provenance).toBe('self');
    expect(mem.date).toBe('2026-08-15T19:40:00+09:00');
    expect(mem.valence).toBe(2);
    expect(mem.importance).toBe(3);
    expect(mem.disclosureLevel).toBe(2);
    expect(mem.summary.length).toBe(200); // EPISODIC_SUMMARY_MAX_CHARS
    expect(mem.openLoop?.note).toBe('まだ続く');
  });

  it('欠落フィールドは既定値(valence0/importance2/disclosure1/daily-life/空配列)', () => {
    const beat: OffscreenBeat = { id: 'b2', arcId: 'a', week: 5, topic: 't', summary: 's' };
    const mem = beatToEpisodic(beat, '2026-01-01T00:00:00+09:00');
    expect(mem.valence).toBe(0);
    expect(mem.importance).toBe(2);
    expect(mem.disclosureLevel).toBe(1);
    expect(mem.category).toBe('daily-life');
    expect(mem.tags).toEqual([]);
    expect(mem.entities).toEqual([]);
    expect(mem.openLoop).toBeUndefined();
  });
});

describe('isoWeekParts (ISO 8601 週)', () => {
  it('2026-01-04 は第1週(1/1 木曜が属する年=2026)', () => {
    expect(isoWeekParts(new Date(2026, 0, 4))).toEqual({
      isoWeek: '2026-W01',
      weekOfYear: 1,
      isoYear: 2026,
    });
  });

  it('翌週は週番号が +1 になる', () => {
    expect(isoWeekParts(new Date(2026, 0, 11)).weekOfYear).toBe(2);
  });

  it('8/15 は W33(誕生日パックの週と一致)', () => {
    expect(isoWeekParts(new Date(2026, 7, 15)).isoWeek).toBe('2026-W33');
  });

  it('weekOfYear は常に 1..53', () => {
    for (let m = 0; m < 12; m++) {
      const w = isoWeekParts(new Date(2026, m, 15)).weekOfYear;
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(53);
    }
  });
});

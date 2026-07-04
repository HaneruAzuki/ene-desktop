import { describe, it, expect } from 'vitest';
import { hasCorrectionCue, augmentWithRecent } from '../../src/memory/remember/correction-cues';
import type { EpisodicMemory, EpisodicRecord } from '../../src/shared/types/memory';

// 訂正リーチの拡張(P4)の純関数検証。合図語は language.json 由来(§4.5)。テストは明示的に渡す。
const CUES = ['違う', 'そうじゃ', '勘違い', '訂正', '本当は'];

describe('correction-cues — hasCorrectionCue', () => {
  it('訂正・否定・記憶違いの合図を検出する', () => {
    expect(hasCorrectionCue('それ違うよ、本当は…', CUES)).toBe(true);
    expect(hasCorrectionCue('そうじゃなくて、こうだよ', CUES)).toBe(true);
    expect(hasCorrectionCue('勘違いしてるって', CUES)).toBe(true);
    expect(hasCorrectionCue('それ訂正させて', CUES)).toBe(true);
  });
  it('合図が無ければ false', () => {
    expect(hasCorrectionCue('今日はいい天気だね', CUES)).toBe(false);
    expect(hasCorrectionCue('ラーメン食べたい', CUES)).toBe(false);
  });
  it('合図語リストが空なら常に false', () => {
    expect(hasCorrectionCue('それ違うよ', [])).toBe(false);
  });
});

function rec(id: string, p: Partial<EpisodicMemory>): EpisodicRecord {
  return { id, memory: { date: '2026-01-01T00:00:00+09:00', topic: 't', summary: 's', importance: 3, category: 'general', ...p } };
}

describe('correction-cues — augmentWithRecent', () => {
  it('base に無い直近の user 記録を date 降順で n 件足す', () => {
    const base = [rec('a', { date: '2026-06-01T00:00:00+09:00' })];
    const user = [
      rec('a', { date: '2026-06-01T00:00:00+09:00' }),
      rec('b', { date: '2026-06-20T00:00:00+09:00' }),
      rec('c', { date: '2026-06-10T00:00:00+09:00' }),
      rec('d', { date: '2026-06-05T00:00:00+09:00' }),
    ];
    const out = augmentWithRecent(base, user, 2);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']); // a(base) + 直近2件 b,c
  });

  it('self / supersede 済みは足さない', () => {
    const user = [
      rec('s', { date: '2026-06-20T00:00:00+09:00', provenance: 'self' }),
      rec('x', { date: '2026-06-19T00:00:00+09:00', supersededBy: 'y' }),
      rec('ok', { date: '2026-06-18T00:00:00+09:00' }),
    ];
    const out = augmentWithRecent([], user, 5);
    expect(out.map((r) => r.id)).toEqual(['ok']);
  });
});

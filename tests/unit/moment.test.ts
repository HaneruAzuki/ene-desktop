import { describe, it, expect } from 'vitest';
import {
  timeOfDayLabel,
  elapsedDays,
  describeElapsed,
  finitenessHint,
} from '../../src/shared/moment';
import { FATIGUE_TURN_THRESHOLD } from '../../src/shared/constants';

// P1/P7: 「いま」の存在文脈(時間帯・経過・有限性トーン)の純粋ロジック。

describe('timeOfDayLabel (P1)', () => {
  it('時刻帯を朝/昼/夕方/夜/深夜に割る', () => {
    expect(timeOfDayLabel(0)).toBe('深夜');
    expect(timeOfDayLabel(4)).toBe('深夜');
    expect(timeOfDayLabel(5)).toBe('朝');
    expect(timeOfDayLabel(10)).toBe('朝');
    expect(timeOfDayLabel(11)).toBe('昼');
    expect(timeOfDayLabel(15)).toBe('昼');
    expect(timeOfDayLabel(16)).toBe('夕方');
    expect(timeOfDayLabel(19)).toBe('夜');
    expect(timeOfDayLabel(22)).toBe('夜');
    expect(timeOfDayLabel(23)).toBe('深夜');
  });
});

describe('elapsedDays / describeElapsed (P1)', () => {
  it('経過日数を正しく数える', () => {
    expect(elapsedDays('2026-06-10', '2026-06-13')).toBe(3);
    expect(elapsedDays('2026-06-13', '2026-06-13')).toBe(0);
  });
  it('未指定・不正・時計巻き戻りは null', () => {
    expect(elapsedDays(undefined, '2026-06-13')).toBeNull();
    expect(elapsedDays('こわれた', '2026-06-13')).toBeNull();
    expect(elapsedDays('2026-06-14', '2026-06-13')).toBeNull(); // 負
  });
  it('同日・初回は経過を出さない(undefined)', () => {
    expect(describeElapsed('2026-06-13', '2026-06-13')).toBeUndefined();
    expect(describeElapsed(undefined, '2026-06-13')).toBeUndefined();
  });
  it('1日=昨日ぶり、数日=N日ぶり、7日以上=久しぶりを添える', () => {
    expect(describeElapsed('2026-06-12', '2026-06-13')).toBe('昨日ぶり');
    expect(describeElapsed('2026-06-10', '2026-06-13')).toBe('3日ぶり');
    expect(describeElapsed('2026-06-01', '2026-06-13')).toContain('しばらく会っていない');
  });
});

describe('finitenessHint (P7・発言内容のみ)', () => {
  it('深夜帯は眠そうなトーンを許可する', () => {
    expect(finitenessHint(23, 0)).toContain('夜遅い');
    expect(finitenessHint(2, 0)).toContain('夜遅い');
  });
  it('日中の長時間会話は疲れたトーンを許可する', () => {
    expect(finitenessHint(14, FATIGUE_TURN_THRESHOLD)).toContain('長く話している');
  });
  it('日中・短い会話ではトーン指示を出さない', () => {
    expect(finitenessHint(14, 3)).toBeUndefined();
  });
});

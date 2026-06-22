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
  it('深夜帯は cadence のターンだけ夜更けの雰囲気を許可(毎ターンではない=寝かしつけ連発を防ぐ)', () => {
    // cadence 先頭(turnsThisSession % N === 1)では出る。
    expect(finitenessHint(23, 1)).toContain('夜遅い');
    expect(finitenessHint(2, 1)).toContain('夜遅い');
  });
  it('夜の文言は寝かしつけを焚きつけず、相手の意思・話題を尊重する(文言を弱めた)', () => {
    const hint = finitenessHint(23, 1) ?? '';
    expect(hint).toContain('促し続けない'); // 「早く休むよう促す」ライセンスを撤去
    expect(hint).toContain('尊重');
  });
  it('深夜でも cadence 外のターンでは出さない(連発しない)', () => {
    expect(finitenessHint(23, 2)).toBeUndefined();
    expect(finitenessHint(23, 5)).toBeUndefined();
  });
  it('日中の長時間会話は疲れたトーンを許可する', () => {
    expect(finitenessHint(14, FATIGUE_TURN_THRESHOLD)).toContain('長く話している');
  });
  it('日中・短い会話ではトーン指示を出さない', () => {
    expect(finitenessHint(14, 3)).toBeUndefined();
  });
});

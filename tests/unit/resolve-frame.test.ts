import { describe, it, expect } from 'vitest';
import { resolveFrame } from '../../src/app/renderer/resolve-frame';
import type { CharacterAnimationData, CharacterState } from '../../src/shared/types/animation';

// フレーム解決(task_13・F-ANIM)の純粋ロジック検証。

const FULL: CharacterAnimationData = {
  frameSize: { width: 832, height: 1281 },
  frames: {
    neutral: 'n', neutral_open: 'no',
    joy: 'j', joy_open: 'jo',
    anger: 'a',
    thinking: 'th', sofa: 'sf',
  },
  map: {
    base: { neutral: 'neutral', joy: 'joy', anger: 'anger' },
    baseOpen: { neutral: 'neutral_open', joy: 'joy_open' },
    thinking: 'thinking',
    sofa: 'sofa',
  },
};

// thinking/sofa を持たない最小定義(フォールバック確認用)。
const MINIMAL: CharacterAnimationData = {
  frameSize: { width: 1, height: 1 },
  frames: { neutral: 'n', joy: 'j' },
  map: { base: { neutral: 'neutral', joy: 'joy' } },
};

function st(part: Partial<CharacterState>): CharacterState {
  return { activity: 'idle', emotion: 'neutral', pose: 'stand', ...part };
}

describe('resolveFrame', () => {
  it('idle: emotion の base フレーム', () => {
    expect(resolveFrame(FULL, st({ activity: 'idle', emotion: 'anger' }), false)).toBe('anger');
  });

  it('idle: 未対応 emotion(surprise)は neutral へフォールバック', () => {
    expect(resolveFrame(FULL, st({ activity: 'idle', emotion: 'surprise' }), false)).toBe('neutral');
  });

  it('talking: flapOpen で baseOpen、閉じで base(表情は保持)', () => {
    expect(resolveFrame(FULL, st({ activity: 'talking', emotion: 'joy' }), true)).toBe('joy_open');
    expect(resolveFrame(FULL, st({ activity: 'talking', emotion: 'joy' }), false)).toBe('joy');
  });

  it('talking: baseOpen が無い emotion は open でも base に留まる', () => {
    // anger は baseOpen を持たない → 開でも anger(base)
    expect(resolveFrame(FULL, st({ activity: 'talking', emotion: 'anger' }), true)).toBe('anger');
  });

  it('talking: 未対応 emotion は neutral へ', () => {
    expect(resolveFrame(FULL, st({ activity: 'talking', emotion: 'surprise' }), true)).toBe('neutral_open');
  });

  it('thinking: map.thinking があればそれ', () => {
    expect(resolveFrame(FULL, st({ activity: 'thinking' }), false)).toBe('thinking');
  });

  it('thinking: map.thinking が無ければ neutral', () => {
    expect(resolveFrame(MINIMAL, st({ activity: 'thinking' }), false)).toBe('neutral');
  });

  it('idle+sofa: map.sofa があればそれ', () => {
    expect(resolveFrame(FULL, st({ activity: 'idle', pose: 'sofa' }), false)).toBe('sofa');
  });

  it('idle+sofa: map.sofa が無ければ neutral', () => {
    expect(resolveFrame(MINIMAL, st({ activity: 'idle', pose: 'sofa' }), false)).toBe('neutral');
  });
});

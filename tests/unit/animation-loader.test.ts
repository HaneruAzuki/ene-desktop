import { describe, it, expect } from 'vitest';
import { validateAnimation } from '../../src/character/animation-loader';

// animation.json バリデーション(task_13・F-ANIM-11)。不正は null=portrait フォールバック。

const VALID = {
  characterId: 'ene',
  frameSize: { width: 832, height: 1281 },
  frames: { neutral: 'portrait.png', joy: 'portrait-happy.png' },
  map: { base: { neutral: 'neutral', joy: 'joy' } },
  timing: { mouthFlapMs: 150 },
};

describe('validateAnimation', () => {
  it('正しい定義を正規化して返す', () => {
    const a = validateAnimation(VALID);
    expect(a).not.toBeNull();
    expect(a?.frameSize).toEqual({ width: 832, height: 1281 });
    expect(a?.frames.neutral).toBe('portrait.png');
    expect(a?.timing?.mouthFlapMs).toBe(150);
  });

  it('frames の文字列でない値は無視する', () => {
    const a = validateAnimation({ ...VALID, frames: { neutral: 'portrait.png', bad: 123, empty: '' } });
    expect(Object.keys(a?.frames ?? {})).toEqual(['neutral']);
  });

  it('frameSize 欠落は null', () => {
    expect(validateAnimation({ ...VALID, frameSize: undefined })).toBeNull();
  });

  it('map.base 欠落は null', () => {
    expect(validateAnimation({ ...VALID, map: {} })).toBeNull();
  });

  it('frames が空(有効値ゼロ)は null', () => {
    expect(validateAnimation({ ...VALID, frames: {} })).toBeNull();
  });

  it('オブジェクトでない入力は null', () => {
    expect(validateAnimation(null)).toBeNull();
    expect(validateAnimation('x')).toBeNull();
  });
});

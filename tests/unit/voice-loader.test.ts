import { describe, it, expect } from 'vitest';
import { validateVoiceConfig, resolveStyle } from '../../src/character/voice-loader';
import type { VoiceConfig } from '../../src/shared/types/voice';

// task_17:voice.json の検証とスタイル解決(design-revision-voice §4.2)。

describe('validateVoiceConfig', () => {
  const valid = {
    engine: 'aivisspeech',
    baseUrl: 'http://127.0.0.1:10101',
    model: 'tsukuyomi',
    styles: {
      neutral: { styleId: 0, speedScale: 1.0 },
      anger: { styleId: 2, intonationScale: 1.3, pitchScale: 0.5 },
    },
  };

  it('妥当な設定を正規化する(未知の pitchScale は採用しない)', () => {
    const c = validateVoiceConfig(valid);
    expect(c?.engine).toBe('aivisspeech');
    expect(c?.styles.neutral).toEqual({ styleId: 0, speedScale: 1.0 });
    // pitchScale はスキーマに無いので落ちる(音質劣化のため使わない)。
    expect(c?.styles.anger).toEqual({ styleId: 2, intonationScale: 1.3 });
  });

  it('engine / baseUrl が無ければ null', () => {
    expect(validateVoiceConfig({ baseUrl: 'x', styles: { neutral: { styleId: 0 } } })).toBeNull();
    expect(validateVoiceConfig({ engine: 'x', styles: { neutral: { styleId: 0 } } })).toBeNull();
  });

  it('neutral スタイルが無ければ null(フォールバック先が必要)', () => {
    expect(
      validateVoiceConfig({ engine: 'x', baseUrl: 'y', styles: { joy: { styleId: 1 } } }),
    ).toBeNull();
  });

  it('styleId 欠落のスタイルは無視する(neutral があれば成立)', () => {
    const c = validateVoiceConfig({
      engine: 'x',
      baseUrl: 'y',
      styles: { neutral: { styleId: 0 }, joy: { speedScale: 1.0 } },
    });
    expect(c?.styles.joy).toBeUndefined();
    expect(c?.styles.neutral).toEqual({ styleId: 0 });
  });

  it('オブジェクトでない入力は null', () => {
    expect(validateVoiceConfig(null)).toBeNull();
    expect(validateVoiceConfig('x')).toBeNull();
  });
});

describe('resolveStyle', () => {
  const config: VoiceConfig = {
    engine: 'aivisspeech',
    baseUrl: 'http://127.0.0.1:10101',
    styles: {
      neutral: { styleId: 0 },
      anger: { styleId: 2, intonationScale: 1.3 },
    },
  };

  it('対応する emotion のスタイルを返す', () => {
    expect(resolveStyle(config, 'anger')).toEqual({ styleId: 2, intonationScale: 1.3 });
  });

  it('未定義の emotion は neutral にフォールバックする', () => {
    expect(resolveStyle(config, 'surprise')).toEqual({ styleId: 0 });
  });
});

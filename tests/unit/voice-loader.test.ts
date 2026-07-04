import { describe, it, expect } from 'vitest';
import { validateVoiceConfig, resolveStyle } from '../../src/voice/tts/voice-loader';
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

  it('妥当な設定を正規化する(pitchScale も声の高さ微調整用に採用する)', () => {
    const c = validateVoiceConfig(valid);
    expect(c?.engine).toBe('aivisspeech');
    expect(c?.styles.neutral).toEqual({ styleId: 0, speedScale: 1.0 });
    // pitchScale は声の高さの微調整に限り採用する(AivisSpeech は大きく動かすと劣化)。
    expect(c?.styles.anger).toEqual({ styleId: 2, intonationScale: 1.3, pitchScale: 0.5 });
  });

  it('engine / baseUrl が無ければ null', () => {
    expect(validateVoiceConfig({ baseUrl: 'x', styles: { neutral: { styleId: 0 } } })).toBeNull();
    expect(validateVoiceConfig({ engine: 'x', styles: { neutral: { styleId: 0 } } })).toBeNull();
  });

  it('neutral スタイルが無ければ null(フォールバック先が必要)', () => {
    expect(
      validateVoiceConfig({
        engine: 'x',
        baseUrl: 'http://127.0.0.1:10101',
        styles: { joy: { styleId: 1 } },
      }),
    ).toBeNull();
  });

  it('styleId 欠落のスタイルは無視する(neutral があれば成立)', () => {
    const c = validateVoiceConfig({
      engine: 'x',
      baseUrl: 'http://127.0.0.1:10101',
      styles: { neutral: { styleId: 0 }, joy: { speedScale: 1.0 } },
    });
    expect(c?.styles.joy).toBeUndefined();
    expect(c?.styles.neutral).toEqual({ styleId: 0 });
  });

  it('オブジェクトでない入力は null', () => {
    expect(validateVoiceConfig(null)).toBeNull();
    expect(validateVoiceConfig('x')).toBeNull();
  });

  it('credit(クレジット文言)を保持する', () => {
    const c = validateVoiceConfig({ ...valid, credit: 'つくよみクレジット' });
    expect(c?.credit).toBe('つくよみクレジット');
  });

  // 声色補正 EQ(任意)。許可種別のみ通し、frequency 必須・gain/q は任意。
  it('妥当な EQ バンドを保持する(type/frequency/gain/q)', () => {
    const c = validateVoiceConfig({
      ...valid,
      eq: [
        { type: 'highshelf', frequency: 3500, gain: -4 },
        { type: 'peaking', frequency: 500, gain: -2, q: 1.2 },
      ],
    });
    expect(c?.eq).toEqual([
      { type: 'highshelf', frequency: 3500, gain: -4 },
      { type: 'peaking', frequency: 500, gain: -2, q: 1.2 },
    ]);
  });

  it('EQ が無ければ eq キーを付けない(従来挙動)', () => {
    const c = validateVoiceConfig(valid);
    expect(c && 'eq' in c).toBe(false);
  });

  it('不正な EQ 要素は捨てる(未知の type / frequency 欠落 / 非配列)', () => {
    const c = validateVoiceConfig({
      ...valid,
      eq: [
        { type: 'allpass', frequency: 1000 }, // 未許可種別 → 捨てる
        { type: 'lowshelf' }, // frequency 欠落 → 捨てる
        { type: 'lowshelf', frequency: 200, gain: 3 }, // 妥当 → 残す
      ],
    });
    expect(c?.eq).toEqual([{ type: 'lowshelf', frequency: 200, gain: 3 }]);
    // 全部不正なら eq キー自体を付けない。
    const none = validateVoiceConfig({ ...valid, eq: [{ type: 'allpass', frequency: 1 }] });
    expect(none && 'eq' in none).toBe(false);
    // 配列でなければ無視。
    const notArray = validateVoiceConfig({ ...valid, eq: { type: 'lowshelf', frequency: 200 } });
    expect(notArray && 'eq' in notArray).toBe(false);
  });

  // baseUrl の URL 検証(SSRF 面の縮小・公開前監査指摘)。http/https の整形式のみ許可。
  it('http(s) のローカル baseUrl は通る(http://127.0.0.1:10101 / localhost)', () => {
    expect(validateVoiceConfig(valid)?.baseUrl).toBe('http://127.0.0.1:10101');
    const localhost = validateVoiceConfig({ ...valid, baseUrl: 'http://localhost:10101' });
    expect(localhost?.baseUrl).toBe('http://localhost:10101');
    const https = validateVoiceConfig({ ...valid, baseUrl: 'https://127.0.0.1:10101' });
    expect(https?.baseUrl).toBe('https://127.0.0.1:10101');
  });

  it('http/https 以外のスキームの baseUrl は null(file: / javascript: / smb:)', () => {
    expect(validateVoiceConfig({ ...valid, baseUrl: 'file:///etc/passwd' })).toBeNull();
    expect(validateVoiceConfig({ ...valid, baseUrl: 'javascript:alert(1)' })).toBeNull();
    expect(validateVoiceConfig({ ...valid, baseUrl: 'smb://host/share' })).toBeNull();
  });

  it('整形式でない baseUrl は null(相対 URL / 空文字 / ホスト名なし)', () => {
    expect(validateVoiceConfig({ ...valid, baseUrl: 'not a url' })).toBeNull();
    expect(validateVoiceConfig({ ...valid, baseUrl: '127.0.0.1:10101' })).toBeNull();
    expect(validateVoiceConfig({ ...valid, baseUrl: '' })).toBeNull();
    expect(validateVoiceConfig({ ...valid, baseUrl: 'http://' })).toBeNull();
  });

  it('baseUrl が文字列でない/欠落していれば従来通り null(挙動不変)', () => {
    expect(validateVoiceConfig({ engine: 'x', styles: { neutral: { styleId: 0 } } })).toBeNull();
    expect(
      validateVoiceConfig({ engine: 'x', baseUrl: 123, styles: { neutral: { styleId: 0 } } }),
    ).toBeNull();
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

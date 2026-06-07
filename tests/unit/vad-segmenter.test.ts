import { describe, it, expect } from 'vitest';
import { VadSegmenter, type VadSegmenterConfig, type VadEvent } from '../../src/conversation/vad-segmenter';

// VadSegmenter は純粋ロジック(確率列 → speech-start/end)。実機検証で 0.5 がクリーン分離だった
// しきい値設計を、ヒステリシス・最小発話・最小無音・barge-in 厳格化の観点でテストする。

// frameMs=32ms 相当(16000/512)。minSpeech=5フレーム(160ms)、minSilence=22フレーム(704ms相当)、
// bargeIn=10フレーム(320ms)になる構成。
const CFG: VadSegmenterConfig = {
  sampleRate: 16000,
  frameSize: 512,
  speechThreshold: 0.5,
  silenceThreshold: 0.35,
  minSilenceMs: 700,
  minSpeechMs: 160,
  bargeInMinSpeechMs: 320,
};

/** 同じ確率を n 回投入し、発生したイベントを集める。 */
function pushN(seg: VadSegmenter, prob: number, n: number): VadEvent[] {
  const out: VadEvent[] = [];
  for (let i = 0; i < n; i++) {
    const ev = seg.push(prob);
    if (ev) out.push(ev);
  }
  return out;
}

describe('VadSegmenter (task_17 Phase C)', () => {
  it('無音だけでは何も起きない', () => {
    const seg = new VadSegmenter(CFG);
    expect(pushN(seg, 0.0, 100)).toEqual([]);
    expect(seg.isSpeaking).toBe(false);
  });

  it('発話が最小フレーム続いて初めて speech-start(デバウンス)', () => {
    const seg = new VadSegmenter(CFG);
    // 5フレーム(160ms/32ms)で開始。4フレーム目までは出ない。
    expect(pushN(seg, 0.9, 4)).toEqual([]);
    expect(seg.isSpeaking).toBe(false);
    expect(seg.push(0.9)).toBe('speech-start');
    expect(seg.isSpeaking).toBe(true);
  });

  it('単発スパイク(1フレームだけ高い)は開始しない', () => {
    const seg = new VadSegmenter(CFG);
    expect(seg.push(0.9)).toBeNull();
    // 無音が来たら発話カウンタはリセット
    expect(pushN(seg, 0.0, 10)).toEqual([]);
    expect(pushN(seg, 0.9, 4)).toEqual([]); // また 0 からなので4では開始しない
    expect(seg.push(0.9)).toBe('speech-start');
  });

  it('発話後、最小無音が続いて speech-end', () => {
    const seg = new VadSegmenter(CFG);
    pushN(seg, 0.9, 5); // start
    // 22フレーム(704ms)で終了。21フレーム目までは出ない。
    expect(pushN(seg, 0.0, 21)).toEqual([]);
    expect(seg.push(0.0)).toBe('speech-end');
    expect(seg.isSpeaking).toBe(false);
  });

  it('発話中の短い無音は終了にならない(無音カウンタがリセット)', () => {
    const seg = new VadSegmenter(CFG);
    pushN(seg, 0.9, 5); // start
    expect(pushN(seg, 0.0, 10)).toEqual([]); // 10フレーム無音(<22)
    expect(seg.push(0.9)).toBeNull(); // 発話復帰でリセット
    expect(pushN(seg, 0.0, 21)).toEqual([]); // また 0 から数え直し
    expect(seg.push(0.0)).toBe('speech-end');
  });

  it('ヒステリシス: 下しきい値(0.35)以上なら発話継続扱い', () => {
    const seg = new VadSegmenter(CFG);
    pushN(seg, 0.9, 5); // start
    // 0.4 は speechThreshold 未満だが silenceThreshold 以上 → 無音とみなさない
    expect(pushN(seg, 0.4, 100)).toEqual([]);
    expect(seg.isSpeaking).toBe(true);
  });

  it('setStrict(true) で開始デバウンスが長くなる(barge-in)', () => {
    const seg = new VadSegmenter(CFG);
    seg.setStrict(true); // bargeIn=10フレーム(320ms)
    expect(pushN(seg, 0.9, 9)).toEqual([]);
    expect(seg.push(0.9)).toBe('speech-start');
  });

  it('reset で状態が初期化される', () => {
    const seg = new VadSegmenter(CFG);
    pushN(seg, 0.9, 5);
    expect(seg.isSpeaking).toBe(true);
    seg.reset();
    expect(seg.isSpeaking).toBe(false);
    expect(pushN(seg, 0.9, 4)).toEqual([]); // また 0 から
  });
});

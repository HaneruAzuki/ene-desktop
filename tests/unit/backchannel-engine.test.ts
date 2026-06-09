import { describe, it, expect } from 'vitest';
import {
  BackchannelEngine,
  frameRms,
  type BackchannelEngineConfig,
} from '../../src/conversation/backchannel-engine';
import type { BackchannelDecision } from '../../src/shared/types/backchannel';

// BackchannelEngine は純粋ロジック(発話確率列 → 相槌スロット)。frameMs=32ms。
// **B-17(fire-on-resume)**: 言いよどみ(pause)では「資格あり(arm)」にするだけで、**発話が再開した瞬間に打つ**。
// 文末の最終ポーズは再開しないので打たない(「うん」=Yes 誤解の解消)。
// ※ 韻律トーン判定(Lv2)は撤去済み(2026-06-10)=タイミングのみ検証する。

// minSpeech=1280ms(40f)、minInterval=1280ms(40f)、pauseTrigger=320ms(10f)、turnEnd=704ms(22f)。
const CFG: BackchannelEngineConfig = {
  sampleRate: 16000,
  frameSize: 512,
  speechThreshold: 0.5,
  silenceThreshold: 0.35,
  minSpeechMs: 1280,
  minIntervalMs: 1280,
  pauseTriggerMs: 320,
  turnEndMs: 704,
};

/** 同じ確率を n 回投入し、発生した相槌を集める。 */
function pushN(eng: BackchannelEngine, prob: number, n: number): BackchannelDecision[] {
  const out: BackchannelDecision[] = [];
  for (let i = 0; i < n; i++) {
    const d = eng.push(prob);
    if (d) out.push(d);
  }
  return out;
}

describe('BackchannelEngine (task_18 Phase A / B-17 fire-on-resume)', () => {
  it('無音だけでは相槌を打たない', () => {
    const eng = new BackchannelEngine(CFG);
    expect(pushN(eng, 0.0, 100)).toEqual([]);
  });

  it('発話が短いと、言いよどみ→再開でも打たない', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 20); // 640ms < minSpeech(1280ms)
    pushN(eng, 0.0, 12); // 言いよどみ(arm)
    expect(eng.push(0.9)).toBeNull(); // 再開しても発話不足で打たない
  });

  it('十分な発話のあと、言いよどみ中は打たず、発話再開で打つ', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40); // 1280ms 発話
    expect(pushN(eng, 0.0, 12)).toEqual([]); // 言いよどみ中は打たない(arm のみ)
    const d = eng.push(0.9); // 発話再開
    expect(d?.kind).toBe('backchannel');
    expect(d?.cue).toBe('continuer'); // 現行は常に continuer
  });

  it('ターン終了長の無音では打たない(再開しても=B-17 文末で鳴らさない)', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40);
    expect(pushN(eng, 0.0, 30)).toEqual([]); // turnEnd(22f)超の無音中は打たない
    expect(eng.push(0.9)).toBeNull(); // その後に発話再開しても武装解除済み=打たない(Yes 誤解の解消)
  });

  it('1つの言いよどみ→再開で1回だけ(続けて発話しても追加で打たない)', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40);
    pushN(eng, 0.0, 12); // 言いよどみ(arm)
    expect(eng.push(0.9)?.kind).toBe('backchannel'); // 再開で1回
    expect(eng.push(0.9)).toBeNull(); // 続けて発話=新たな言いよどみ無し→打たない
  });

  it('頻度ガバナ: 間隔未達なら2回目を打たない', () => {
    const cfg: BackchannelEngineConfig = { ...CFG, minSpeechMs: 320, minIntervalMs: 3200 };
    const eng = new BackchannelEngine(cfg); // speech=10f, interval=100f
    pushN(eng, 0.9, 10);
    pushN(eng, 0.0, 12);
    expect(eng.push(0.9)?.kind).toBe('backchannel'); // 1回目(sinceLast→0)
    pushN(eng, 0.9, 10);
    pushN(eng, 0.0, 12);
    expect(eng.push(0.9)).toBeNull(); // interval(3200ms)未達で抑制
  });

  it('十分間隔が空けば再び打てる', () => {
    const cfg: BackchannelEngineConfig = { ...CFG, minSpeechMs: 320, minIntervalMs: 640 };
    const eng = new BackchannelEngine(cfg);
    pushN(eng, 0.9, 10);
    pushN(eng, 0.0, 12);
    expect(eng.push(0.9)?.kind).toBe('backchannel'); // 1回目
    pushN(eng, 0.9, 20); // 発話を積む
    pushN(eng, 0.0, 12);
    expect(eng.push(0.9)?.kind).toBe('backchannel'); // 間隔を満たし2回目
  });

  it('ヒステリシス帯(silence..speech)は継続扱いで言いよどみにしない', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40);
    pushN(eng, 0.4, 50); // 0.4 は silence(0.35)以上=無音にしない(arm されない)
    expect(eng.push(0.9)).toBeNull(); // 再開しても arm されてない=打たない
  });

  it('reset で状態が初期化される', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40);
    eng.reset();
    pushN(eng, 0.9, 39); // reset 後は 0 から(minSpeech に1フレーム足りない)
    pushN(eng, 0.0, 12);
    expect(eng.push(0.9)).toBeNull();
  });
});

describe('frameRms (VAD 取り込み診断にも使用)', () => {
  it('一定振幅の RMS は振幅に等しい', () => {
    expect(frameRms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5, 5);
  });
  it('無音は 0', () => {
    expect(frameRms(new Float32Array(64))).toBe(0);
  });
  it('空配列は 0(0除算しない)', () => {
    expect(frameRms(new Float32Array(0))).toBe(0);
  });
});

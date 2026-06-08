import { describe, it, expect } from 'vitest';
import {
  BackchannelEngine,
  type BackchannelEngineConfig,
} from '../../src/conversation/backchannel-engine';
import type { BackchannelDecision } from '../../src/shared/types/backchannel';

// BackchannelEngine は純粋ロジック(発話確率列 → 相槌スロット)。VadSegmenter と同じ frameMs=32ms 相当。
// 「持続発話 → 短い言いよどみ(turn-end 手前)」を相槌として発火し、頻度ガバナで打ちすぎを防ぐ。

// frameMs=32ms。minSpeech=1280ms(40フレーム)、minInterval=1280ms(40フレーム)、
// pauseTrigger=320ms(10フレーム)、turnEnd=704ms(22フレーム)になる構成(全部フレーム境界で割り切れる)。
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

describe('BackchannelEngine (task_18 Phase A)', () => {
  it('無音だけでは相槌を打たない', () => {
    const eng = new BackchannelEngine(CFG);
    expect(pushN(eng, 0.0, 100)).toEqual([]);
  });

  it('発話が短いと(言いよどみが来ても)打たない', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 20); // 640ms < minSpeech(1280ms)
    expect(pushN(eng, 0.0, 15)).toEqual([]); // 言いよどみが来ても発話が足りない
  });

  it('十分な発話のあとの短い言いよどみで1回打つ', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40); // 1280ms 発話
    // 10フレーム(320ms)の言いよどみ=pauseTrigger 到達で発火。9フレーム目までは出ない。
    expect(pushN(eng, 0.0, 9)).toEqual([]);
    const d = eng.push(0.0); // 10フレーム目
    expect(d).toEqual({ kind: 'backchannel', cue: 'continuer' });
  });

  it('1つの言いよどみ区間では1回しか打たない', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40);
    const fired = pushN(eng, 0.0, 21); // turnEnd(22)手前まで無音を続ける
    expect(fired).toHaveLength(1); // スロット内で複数回打たない
  });

  it('ターン終了(turnEnd以上の無音)に達したら相槌は打たない(=応答の入り)', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40);
    // pauseTrigger(10)で1回打つが、それ以降 turnEnd を超えても追加で打たない。
    const fired = pushN(eng, 0.0, 40); // 1280ms 無音(turnEnd 704ms 超)
    expect(fired).toHaveLength(1);
  });

  it('頻度ガバナ: 発話が足りても間隔未達なら2回目を打たない', () => {
    // minInterval を minSpeech と分離して、ガバナ単独の効きを検証する。
    const cfg: BackchannelEngineConfig = { ...CFG, minSpeechMs: 320, minIntervalMs: 3200 };
    const eng = new BackchannelEngine(cfg); // speech=10f, interval=100f, pauseTrigger=10f
    pushN(eng, 0.9, 10);
    expect(pushN(eng, 0.0, 10)).toHaveLength(1); // 1回目(sinceLast→0)
    pushN(eng, 0.9, 10); // 発話は足りる(320ms)が、経過は 320ms のみ
    expect(pushN(eng, 0.0, 10)).toEqual([]); // interval(3200ms)未達で抑制
  });

  it('十分間隔が空けば再び打てる', () => {
    const cfg: BackchannelEngineConfig = { ...CFG, minSpeechMs: 320, minIntervalMs: 640 };
    const eng = new BackchannelEngine(cfg);
    pushN(eng, 0.9, 10);
    expect(pushN(eng, 0.0, 10)).toHaveLength(1); // 1回目
    pushN(eng, 0.9, 20); // 640ms 発話 → 経過も 640ms(=minInterval)
    expect(pushN(eng, 0.0, 10)).toHaveLength(1); // 間隔を満たし2回目
  });

  it('ヒステリシス帯(silence..speech)は継続扱いで言いよどみにしない', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40);
    expect(pushN(eng, 0.4, 50)).toEqual([]); // 0.4 は silence(0.35)以上=無音としない
  });

  it('reset で状態が初期化される', () => {
    const eng = new BackchannelEngine(CFG);
    pushN(eng, 0.9, 40);
    eng.reset();
    pushN(eng, 0.9, 39); // reset 後は 0 から(minSpeech に1フレーム足りない)
    expect(pushN(eng, 0.0, 15)).toEqual([]);
  });
});

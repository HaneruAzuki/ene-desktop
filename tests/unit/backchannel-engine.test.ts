import { describe, it, expect } from 'vitest';
import {
  BackchannelEngine,
  frameRms,
  frameF0,
  adaptiveThreshold,
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
  emphasisRatio: 1.4,
  pitchRatio: 1.2,
};

/** 1文(=持続発話＋言いよどみ)を投入し、発火した相槌を返す。エネルギー韻律テスト用(f0=0)。 */
function phrase(eng: BackchannelEngine, rms: number, speechFrames = 60): BackchannelDecision | undefined {
  pushRms(eng, 0.9, rms, speechFrames);
  return pushRms(eng, 0.0, 0, 12)[0];
}

/** 1文を rms＋f0 付きで投入(ピッチ韻律テスト用)。 */
function phrasePitch(
  eng: BackchannelEngine,
  rms: number,
  f0: number,
  speechFrames = 60,
): BackchannelDecision | undefined {
  for (let i = 0; i < speechFrames; i++) eng.push(0.9, rms, f0);
  let fired: BackchannelDecision | undefined;
  for (let i = 0; i < 12; i++) {
    const d = eng.push(0.0, 0, 0);
    if (d) fired = d;
  }
  return fired;
}

/** 同じ確率を n 回投入し、発生した相槌を集める。 */
function pushN(eng: BackchannelEngine, prob: number, n: number): BackchannelDecision[] {
  const out: BackchannelDecision[] = [];
  for (let i = 0; i < n; i++) {
    const d = eng.push(prob);
    if (d) out.push(d);
  }
  return out;
}

/** prob と rms を n フレーム投入し、発生した相槌を集める(韻律テスト用)。 */
function pushRms(eng: BackchannelEngine, prob: number, rms: number, n: number): BackchannelDecision[] {
  const out: BackchannelDecision[] = [];
  for (let i = 0; i < n; i++) {
    const d = eng.push(prob, rms);
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
    expect(d?.kind).toBe('backchannel');
    expect(d?.cue).toBe('continuer'); // rms 未指定=韻律情報なし → continuer
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

describe('BackchannelEngine 韻律による型選択 (task_18 Lv2・文単位ピーク基準)', () => {
  it('初回は必ず continuer(平常の基準がまだ無い)', () => {
    const eng = new BackchannelEngine(CFG);
    const d = phrase(eng, 0.3); // 大きくても初回は基準が無い=比1
    expect(d?.cue).toBe('continuer');
  });

  it('同レベルが続けば continuer(比≈1)', () => {
    const eng = new BackchannelEngine(CFG);
    phrase(eng, 0.1); // 1文目=基準を確立
    const d = phrase(eng, 0.1); // 2文目=同レベル
    expect(d?.cue).toBe('continuer');
  });

  it('平常より大きい山の文は surprise(語尾がしぼんでもピークで判定)', () => {
    const eng = new BackchannelEngine(CFG);
    phrase(eng, 0.1); // 平常 0.1 を確立(初回 continuer)
    // 2文目: 強い山(0.3)のあと語尾がしぼむ(0.12)→ ピーク保持で比が跳ねる。発話は計45フレーム(>minSpeech)。
    pushRms(eng, 0.9, 0.1, 35);
    pushRms(eng, 0.9, 0.3, 6);
    pushRms(eng, 0.9, 0.12, 4);
    const d = pushRms(eng, 0.0, 0, 12)[0];
    expect(d?.cue).toBe('surprise');
    expect(d?.energyRatio ?? 0).toBeGreaterThanOrEqual(1.4);
  });

  it('興奮が数文続くと新しい平常に馴染む(比が落ち着く)', () => {
    const eng = new BackchannelEngine(CFG);
    phrase(eng, 0.1); // 平常 0.1
    const first = phrase(eng, 0.3); // 跳ねる(surprise)
    expect(first?.cue).toBe('surprise');
    // 同じ 0.3 が続くと baselinePeak が 0.3 へ寄り、やがて continuer へ。
    let last: BackchannelDecision | undefined;
    for (let i = 0; i < 12; i++) last = phrase(eng, 0.3);
    expect(last?.cue).toBe('continuer');
  });
});

describe('frameRms (task_18 Lv2)', () => {
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

/** 周波数 f の正弦波 512 サンプル(16kHz)。 */
function sine(f: number, sr = 16000, n = 512): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / sr);
  return x;
}

describe('frameF0 (task_18 Lv2・ピッチ推定)', () => {
  it('正弦波の F0 を推定する(150Hz)', () => {
    expect(frameF0(sine(150))).toBeCloseTo(150, -1); // ±5Hz 以内
  });
  it('高い正弦波も推定する(250Hz)', () => {
    expect(frameF0(sine(250))).toBeCloseTo(250, -1);
  });
  it('無音は 0(有声でない)', () => {
    expect(frameF0(new Float32Array(512))).toBe(0);
  });
});

describe('BackchannelEngine ピッチによる型選択 (task_18 Lv2・主信号)', () => {
  it('声が高くなると surprise(平常ピッチ比が閾値超え)', () => {
    const eng = new BackchannelEngine(CFG);
    phrasePitch(eng, 0.1, 150); // 平常ピッチ 150Hz を確立(初回 continuer)
    const d = phrasePitch(eng, 0.1, 220); // 高いピッチ(220/150≈1.47 ≥ 1.2)→ surprise
    expect(d?.cue).toBe('surprise');
    expect(d?.pitchRatio ?? 0).toBeGreaterThanOrEqual(1.2);
  });

  it('同じピッチ・同じ大きさなら continuer', () => {
    const eng = new BackchannelEngine(CFG);
    phrasePitch(eng, 0.1, 150);
    const d = phrasePitch(eng, 0.1, 150);
    expect(d?.cue).toBe('continuer');
  });
});

describe('BackchannelEngine 学習値の保存/復元 (task_18 Lv2b・永続化)', () => {
  it('getCalibration → loadCalibration で往復できる', () => {
    const a = new BackchannelEngine(CFG);
    // いくつか学習させる(ピッチ付きの文を数回)。
    phrasePitch(a, 0.1, 150);
    phrasePitch(a, 0.12, 200);
    phrasePitch(a, 0.1, 160);
    const cal = a.getCalibration();
    expect(cal.ratioCount).toBeGreaterThan(0);

    const b = new BackchannelEngine(CFG);
    b.loadCalibration(cal);
    expect(b.getCalibration()).toEqual(cal);
  });

  it('壊れた/欠けた値は無視して現在値を保つ', () => {
    const eng = new BackchannelEngine(CFG);
    phrasePitch(eng, 0.1, 150);
    const before = eng.getCalibration();
    // @ts-expect-error 異常値を意図的に渡す
    eng.loadCalibration({ baselinePitch: 'x', ratioCount: -5, pRatioVar: NaN });
    const after = eng.getCalibration();
    expect(after.baselinePitch).toBe(before.baselinePitch); // 不正は無視
    expect(after.ratioCount).toBeGreaterThanOrEqual(0); // 負は弾く
    expect(Number.isFinite(after.pRatioVar)).toBe(true);
  });

  it('null/undefined を渡しても安全(何もしない)', () => {
    const eng = new BackchannelEngine(CFG);
    expect(() => eng.loadCalibration(null)).not.toThrow();
    expect(() => eng.loadCalibration(undefined)).not.toThrow();
  });
});

describe('adaptiveThreshold (task_18 Lv2・自己キャリブレーション)', () => {
  const P = { fixed: 1.2, floor: 1.12, ceil: 1.7, warmup: 6, k: 1.3 };

  it('warmup 件未満は固定値を返す(分布が定まるまで)', () => {
    expect(adaptiveThreshold(1.0, 0.05, 0, P)).toBe(1.2);
    expect(adaptiveThreshold(1.0, 0.5, 5, P)).toBe(1.2); // count<warmup なら std 無視
  });

  it('warmup 後は 平均+K×σ を返す', () => {
    // 1.0 + 1.3*0.2 = 1.26
    expect(adaptiveThreshold(1.0, 0.2, 10, P)).toBeCloseTo(1.26, 5);
  });

  it('分散が小さいと floor でクランプ(下がりすぎない)', () => {
    // 1.0 + 1.3*0.01 = 1.013 < floor 1.12 → floor
    expect(adaptiveThreshold(1.0, 0.01, 10, P)).toBe(1.12);
  });

  it('分散が大きいと ceil でクランプ(上がりすぎない)', () => {
    // 1.2 + 1.3*0.9 = 2.37 > ceil 1.7 → ceil
    expect(adaptiveThreshold(1.2, 0.9, 10, P)).toBe(1.7);
  });
});

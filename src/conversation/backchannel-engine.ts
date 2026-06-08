import {
  VAD_FRAME_SIZE,
  VAD_SPEECH_THRESHOLD,
  VAD_SILENCE_THRESHOLD,
  VAD_MIN_SILENCE_MS,
  STT_SAMPLE_RATE,
  BACKCHANNEL_MIN_SPEECH_MS,
  BACKCHANNEL_MIN_INTERVAL_MS,
  BACKCHANNEL_PAUSE_TRIGGER_MS,
  BACKCHANNEL_EMPHASIS_RATIO,
  BACKCHANNEL_PITCH_RATIO,
} from '../shared/constants';
import type {
  BackchannelCalibration,
  BackchannelCue,
  BackchannelDecision,
} from '../shared/types/backchannel';

/** 数値で有限ならそれを、さもなくば fallback を返す(壊れた保存値への防御)。 */
function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 1フレームの RMS(二乗平均平方根=エネルギー)。韻律(声の勢い)判定に使う。純粋。 */
export function frameRms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}

/**
 * 1フレームの基本周波数 F0(Hz・声の高さ)を自己相関で推定する。純粋。
 * 興奮すると声が高くなる=ピッチが主信号(エネルギーより安定・実機判断)。
 * 有声でない/雑音(相関ピークが弱い)なら 0 を返す。
 */
export function frameF0(frame: Float32Array, sampleRate: number = STT_SAMPLE_RATE): number {
  const n = frame.length;
  const minLag = Math.floor(sampleRate / F0_MAX_HZ);
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / F0_MIN_HZ));
  if (n < minLag + 2) return 0;
  let r0 = 0;
  for (let i = 0; i < n; i++) {
    const v = frame[i] ?? 0;
    r0 += v * v;
  }
  if (r0 < 1e-6) return 0; // ほぼ無音
  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    const lim = n - lag;
    for (let i = 0; i < lim; i++) s += (frame[i] ?? 0) * (frame[i + lag] ?? 0);
    const norm = s / r0; // 正規化自己相関(おおよそ[-1,1])
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestCorr < F0_CLARITY_MIN) return 0; // 有声でない/雑音
  return sampleRate / bestLag;
}

// エネルギー判定(韻律): recentPeak=この発話区間の「一番大きかった瞬間」(減衰保持)。
// baselinePeak=典型的な発話区間ピークの EMA(**相槌ごと**に更新=フレーム単位でなく文単位)。
// 比 = recentPeak / baselinePeak。「いつもの文より大きい山の文」= 強調 → surprise。
// ★要点(実機ログで判明): baseline をフレーム単位EMAにすると興奮文の最中に baseline 自身が
//   追従してしまい比が動かない(平常/興奮とも比≈1.4)。一方 絶対ピークは興奮で 1.6 倍だった。
//   → **文単位ピークの長期EMA**で比べると、1文だけ大きいと比が跳ね、数文続けば徐々に新平常へ馴染む。
/** 文単位ピーク baseline の追従率(≈7文で馴染む)。エネルギー・ピッチ共通。 */
const PHRASE_BASELINE_ALPHA = 0.15;
/** ピークの減衰係数(発話フレームごと)。0.97^31≈0.39 で約1秒は山を保持。 */
const PEAK_DECAY = 0.97;
/** baseline が小さすぎる(初回/ほぼ無音)ときは比を 1 とみなす(0除算回避・初回は continuer)。 */
const MIN_BASELINE = 1e-4;

// ピッチ(F0)推定・判定のパラメータ。
/** F0 探索範囲(Hz)。日本語話者の地声をカバー。 */
const F0_MIN_HZ = 70;
const F0_MAX_HZ = 400;
/** 有声判定の正規化自己相関しきい値(未満は無声/雑音=F0なし)。 */
const F0_CLARITY_MIN = 0.3;
/** ピッチピークの小さすぎ判定(0除算回避)。 */
const MIN_PITCH = 1;

// 自己キャリブレーション(Lv2): 比(pRatio/eRatio)の分布を学習し、閾値を自動で決める。
// 手調整(ログを読んで閾値を合わせる)をエンジン自身に肩代わりさせる。
/** 比の分布EMA(平均/分散)の追従率。 */
const RATIO_ALPHA = 0.08;
/** 閾値 = 平均 + K×標準偏差(上位の外れ値=強調 を surprise に)。 */
const RATIO_K = 1.3;
/** これだけ相槌がたまるまでは固定閾値(cfg)を使う(分布が定まるまでの保険)。 */
const RATIO_WARMUP = 6;
/** ピッチ自己キャリブレーション閾値の下限/上限。 */
const PITCH_THRESH_FLOOR = 1.12;
const PITCH_THRESH_CEIL = 1.7;
/** エネルギー自己キャリブレーション閾値の下限/上限。 */
const ENERGY_THRESH_FLOOR = 1.25;
const ENERGY_THRESH_CEIL = 2.4;

/** 自己キャリブレーション閾値の算出パラメータ。 */
export interface AdaptiveThresholdParams {
  /** warmup 中(分布が定まる前)に使う固定閾値。 */
  fixed: number;
  floor: number;
  ceil: number;
  warmup: number;
  k: number;
}

/**
 * 比の分布(平均・標準偏差)と件数から、surprise 判定の閾値を返す(純粋)。
 * warmup 件未満は固定値。以降は 平均+K×σ を floor..ceil でクランプ。
 */
export function adaptiveThreshold(
  mean: number,
  std: number,
  count: number,
  p: AdaptiveThresholdParams,
): number {
  if (count < p.warmup) return p.fixed;
  const t = mean + p.k * std;
  return Math.min(p.ceil, Math.max(p.floor, t));
}

// 相槌タイミングのリアルタイム判定(task_18 Phase A・聞くターン)。
// 既存 VadSegmenter と同じく「発話確率列 → イベント」の純粋ロジック(I/O も乱数も持たない=単体テスト対象)。
//
// 着眼: 人は相手が「ひと区切り(短い言いよどみ)」したところで相槌を打つ。
//   = 十分に続いた発話のあと、ターン終了には至らない短い無音(言いよどみ)を検出して発火。
//   発話確率(prob)の軌跡だけで判定でき、Claude もネットワークも要らない(完全ローカル)。
//
// 設計の憲法(task_18): 尺・有無は「良い聞き手とは」で決める。Claude が返るまでの時間では決めない。

export interface BackchannelEngineConfig {
  sampleRate: number;
  frameSize: number;
  speechThreshold: number;
  silenceThreshold: number;
  /** 最初の相槌までに必要な持続発話(ms)。 */
  minSpeechMs: number;
  /** 相槌の最小間隔(ms・頻度ガバナ)。 */
  minIntervalMs: number;
  /** 言いよどみが相槌スロットになる継続(ms)。 */
  pauseTriggerMs: number;
  /** ターン終了とみなす無音(ms)。これに達したら相槌でなく応答の入り=発火しない。 */
  turnEndMs: number;
  /** 韻律: surprise に切り替える 直近/平常 エネルギー比(補助・Lv2)。 */
  emphasisRatio: number;
  /** 韻律: surprise に切り替える 直近/平常 ピッチ比(主・Lv2)。 */
  pitchRatio: number;
}

export const DEFAULT_BACKCHANNEL_CONFIG: BackchannelEngineConfig = {
  sampleRate: STT_SAMPLE_RATE,
  frameSize: VAD_FRAME_SIZE,
  speechThreshold: VAD_SPEECH_THRESHOLD,
  silenceThreshold: VAD_SILENCE_THRESHOLD,
  minSpeechMs: BACKCHANNEL_MIN_SPEECH_MS,
  minIntervalMs: BACKCHANNEL_MIN_INTERVAL_MS,
  pauseTriggerMs: BACKCHANNEL_PAUSE_TRIGGER_MS,
  turnEndMs: VAD_MIN_SILENCE_MS,
  emphasisRatio: BACKCHANNEL_EMPHASIS_RATIO,
  pitchRatio: BACKCHANNEL_PITCH_RATIO,
};

export class BackchannelEngine {
  private readonly frameMs: number;
  /** 直近の連続発話の長さ(ms)。相槌を打つ/ターンが進むとリセット。 */
  private speechMs = 0;
  /** 現在の連続無音の長さ(ms)。発話復帰でリセット。 */
  private pauseMs = 0;
  /** 最後に相槌を打ってからの経過(ms・頻度ガバナ)。十分大きい値で開始(初手を妨げない)。 */
  private sinceLastMs: number;
  /** この言いよどみ区間で既に1回打ったか(1スロット1回)。 */
  private firedThisPause = false;
  /** 一度でも発話を観測したか(無音だけの間は相槌を打たない)。 */
  private speaking = false;
  /** 典型的な発話ピーク(文単位EMA・その人の平常の山)。セッションをまたいで保持。 */
  private baselinePeak = 0;
  /** いまの発話区間の山(減衰保持の最大RMS)。相槌ごと/ターンごとに仕切り直し。 */
  private recentPeak = 0;
  /** 典型的な発話ピッチ(文単位EMA・その人の平常の高さ)。セッションをまたいで保持。 */
  private baselinePitch = 0;
  /** いまの発話区間のピッチの山(減衰保持の最大F0)。相槌ごと/ターンごとに仕切り直し。 */
  private recentPitchPeak = 0;
  // 自己キャリブレーション(Lv2): 比の分布EMA。reset では消さない(学習なので蓄積)。将来ディスク保存。
  private pRatioMean = 1;
  private pRatioVar = 0;
  private eRatioMean = 1;
  private eRatioVar = 0;
  private ratioCount = 0;

  constructor(private readonly cfg: BackchannelEngineConfig = DEFAULT_BACKCHANNEL_CONFIG) {
    this.frameMs = (cfg.frameSize / cfg.sampleRate) * 1000;
    this.sinceLastMs = cfg.minIntervalMs; // 初回はガバナで妨げない
  }

  /**
   * 1フレームの発話確率＋RMS(任意)を投入。相槌を打つべきなら BackchannelDecision を返す(無ければ null)。
   * rms を渡すと韻律で型を出し分ける(Lv2): 直近が平常より強い=強調 → surprise、そうでなければ continuer。
   * rms 省略(=0)なら従来どおり continuer 固定。
   */
  push(prob: number, rms = 0, f0 = 0): BackchannelDecision | null {
    this.sinceLastMs += this.frameMs;

    if (prob >= this.cfg.speechThreshold) {
      // 発話中: 言いよどみカウンタをリセットし、発話継続を積む。
      this.speaking = true;
      this.speechMs += this.frameMs;
      this.pauseMs = 0;
      this.firedThisPause = false;
      this.updateProsody(rms, f0);
      return null;
    }

    if (prob >= this.cfg.silenceThreshold) {
      // ヒステリシス帯(継続扱い)=無音にしない。
      return null;
    }

    // 無音(言いよどみ候補)。
    if (!this.speaking) return null; // まだ誰も話していない
    this.pauseMs += this.frameMs;

    const inSlot =
      this.pauseMs >= this.cfg.pauseTriggerMs && this.pauseMs < this.cfg.turnEndMs;
    const ready =
      !this.firedThisPause &&
      this.speechMs >= this.cfg.minSpeechMs &&
      this.sinceLastMs >= this.cfg.minIntervalMs;

    if (inSlot && ready) {
      this.firedThisPause = true;
      this.sinceLastMs = 0;
      this.speechMs = 0; // 次の相槌は発話の積み直しから(自然な間隔)
      // エネルギー比(補助)とピッチ比(主)を「いまの文 ÷ 典型的な文」で評価。
      const eBaseline = this.baselinePeak;
      const eRatio = eBaseline > MIN_BASELINE ? this.recentPeak / eBaseline : 1;
      const pBaseline = this.baselinePitch;
      const pRatio = pBaseline > MIN_PITCH ? this.recentPitchPeak / pBaseline : 1;
      // 自己キャリブレーション閾値(あなたの比の分布から自動算出・warmup 中は固定値)。
      const pThresh = adaptiveThreshold(this.pRatioMean, Math.sqrt(this.pRatioVar), this.ratioCount, {
        fixed: this.cfg.pitchRatio,
        floor: PITCH_THRESH_FLOOR,
        ceil: PITCH_THRESH_CEIL,
        warmup: RATIO_WARMUP,
        k: RATIO_K,
      });
      const eThresh = adaptiveThreshold(this.eRatioMean, Math.sqrt(this.eRatioVar), this.ratioCount, {
        fixed: this.cfg.emphasisRatio,
        floor: ENERGY_THRESH_FLOOR,
        ceil: ENERGY_THRESH_CEIL,
        warmup: RATIO_WARMUP,
        k: RATIO_K,
      });
      // 声が高い(主) または 大きい(補助)なら強調 → surprise。
      const emphatic = pRatio >= pThresh || eRatio >= eThresh;
      const cue: BackchannelCue = emphatic ? 'surprise' : 'continuer';
      const decision: BackchannelDecision = {
        kind: 'backchannel',
        cue,
        energyRatio: eRatio,
        energyPeak: this.recentPeak,
        energyBaseline: eBaseline,
        energyThreshold: eThresh,
        pitchRatio: pRatio,
        pitchPeak: this.recentPitchPeak,
        pitchBaseline: pBaseline,
        pitchThreshold: pThresh,
      };
      // 比の分布を更新(EMA 平均/分散)=次回以降の閾値が賢くなる。
      this.updateRatioStats(pRatio, eRatio);
      // 典型値を今回の山で更新(文単位EMA=長期の平常)。初回は seed。ピッチは有声だった時のみ。
      this.baselinePeak =
        this.baselinePeak === 0
          ? this.recentPeak
          : this.baselinePeak + PHRASE_BASELINE_ALPHA * (this.recentPeak - this.baselinePeak);
      if (this.recentPitchPeak > 0) {
        this.baselinePitch =
          this.baselinePitch === 0
            ? this.recentPitchPeak
            : this.baselinePitch + PHRASE_BASELINE_ALPHA * (this.recentPitchPeak - this.baselinePitch);
      }
      this.recentPeak = 0;
      this.recentPitchPeak = 0;
      return decision;
    }
    return null;
  }

  /** いまの発話区間のエネルギー/ピッチの山を更新(発話フレームのみ・減衰保持の最大)。 */
  private updateProsody(rms: number, f0: number): void {
    if (rms > 0) this.recentPeak = Math.max(rms, this.recentPeak * PEAK_DECAY);
    // 無声フレーム(f0=0)はピッチを下げない(保持)。有声のときだけ山を更新。
    if (f0 > 0) this.recentPitchPeak = Math.max(f0, this.recentPitchPeak * PEAK_DECAY);
  }

  /** 比の分布(平均・分散)を EMA で更新する(自己キャリブレーション・Lv2)。 */
  private updateRatioStats(pRatio: number, eRatio: number): void {
    const dp = pRatio - this.pRatioMean;
    this.pRatioMean += RATIO_ALPHA * dp;
    this.pRatioVar = (1 - RATIO_ALPHA) * (this.pRatioVar + RATIO_ALPHA * dp * dp);
    const de = eRatio - this.eRatioMean;
    this.eRatioMean += RATIO_ALPHA * de;
    this.eRatioVar = (1 - RATIO_ALPHA) * (this.eRatioVar + RATIO_ALPHA * de * de);
    this.ratioCount++;
  }

  /** ターン境界等で状態を初期化(次の発話を 0 から数え直す)。平常エネルギーは保持する。 */
  reset(): void {
    this.speechMs = 0;
    this.pauseMs = 0;
    this.sinceLastMs = this.cfg.minIntervalMs;
    this.firedThisPause = false;
    this.speaking = false;
    // 直近の山は毎ターン仕切り直し(baseline=平常 は保持して相対判定を安定させる)。
    this.recentPeak = 0;
    this.recentPitchPeak = 0;
  }

  /** 学習値(音響キャリブレーション)を取り出す(永続化用・Lv2b)。 */
  getCalibration(): BackchannelCalibration {
    return {
      baselinePeak: this.baselinePeak,
      baselinePitch: this.baselinePitch,
      pRatioMean: this.pRatioMean,
      pRatioVar: this.pRatioVar,
      eRatioMean: this.eRatioMean,
      eRatioVar: this.eRatioVar,
      ratioCount: this.ratioCount,
    };
  }

  /** 保存済みの学習値を復元する(壊れた値は無視して現在値を維持・Lv2b)。 */
  loadCalibration(c: Partial<BackchannelCalibration> | null | undefined): void {
    if (!c || typeof c !== 'object') return;
    this.baselinePeak = Math.max(0, finiteOr(c.baselinePeak, this.baselinePeak));
    this.baselinePitch = Math.max(0, finiteOr(c.baselinePitch, this.baselinePitch));
    this.pRatioMean = finiteOr(c.pRatioMean, this.pRatioMean);
    this.pRatioVar = Math.max(0, finiteOr(c.pRatioVar, this.pRatioVar));
    this.eRatioMean = finiteOr(c.eRatioMean, this.eRatioMean);
    this.eRatioVar = Math.max(0, finiteOr(c.eRatioVar, this.eRatioVar));
    this.ratioCount = Math.max(0, Math.floor(finiteOr(c.ratioCount, this.ratioCount)));
  }
}

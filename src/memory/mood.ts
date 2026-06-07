import {
  MOOD_TAU_POS_DAYS,
  MOOD_TAU_NEG_DAYS,
  MOOD_FLOOR,
  MOOD_PRIOR_WEIGHT,
} from '../shared/constants';
import type { EpisodicRecord } from '../shared/types/memory';

// 心情の導出(task_16・design-revision-character-heart §3.2)。
//
// 方針:**状態を保存しない**。会話のたびに直近の記憶から算術で出す(LLM 不要・ローカル)。
//  - mood_global = Σ wᵢ·valenceᵢ / Σ wᵢ、wᵢ = exp(-Δdays/τ)
//  - τ は記憶ごとに valence の符号で選ぶ。**負は速く減衰(τ_neg<τ_pos)=復元力**(沈黙すれば自然に中立へ)。
//  - canon(provenance:'self')は mood を動かさない(過去の人生記憶が常時心情を支配しない)。
//  - 中立プライア(MOOD_PRIOR_WEIGHT)で 0 へ縮約 → 沈黙すれば自然に中立へ(古い負で暗転ロックしない)。
//  - 下限 MOOD_FLOOR(“デレの床”)で暗転ロックを回避(倫理の一線)。

const DAY_MS = 86_400_000;

/**
 * 直近の user episodic から心情(-2..+2 目安)を導出する。now は注入(テスト決定化)。
 * canon・日付不正・valence 欠落(=0)は安全に扱う。記憶が無ければ 0(中立)。
 * 分母に中立プライアを足すことで、記憶が古い/少ないほど 0 へ寄る。
 */
export function deriveMood(records: EpisodicRecord[], nowMs: number): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const { memory } of records) {
    if (memory.provenance === 'self') continue; // canon は対象外(§3.2)
    const t = Date.parse(memory.date);
    if (Number.isNaN(t)) continue;
    const valence = memory.valence ?? 0;
    const deltaDays = Math.max(0, (nowMs - t) / DAY_MS);
    const tau = valence >= 0 ? MOOD_TAU_POS_DAYS : MOOD_TAU_NEG_DAYS;
    const w = Math.exp(-deltaDays / tau);
    weightedSum += w * valence;
    weightTotal += w;
  }
  // 中立プライアで縮約(沈黙→0・微細化)。記憶ゼロでも 0/(0+prior)=0。
  return weightedSum / (weightTotal + MOOD_PRIOR_WEIGHT);
}

/** clampedMood = max(mood, MOOD_FLOOR)。下げ過ぎ防止(デレの床)。 */
export function clampMood(mood: number): number {
  return Math.max(mood, MOOD_FLOOR);
}

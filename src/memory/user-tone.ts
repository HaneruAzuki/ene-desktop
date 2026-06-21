import { DAY_MS, USER_TONE_TAU_DAYS, USER_TONE_PRIOR_WEIGHT } from '../shared/constants';
import type { EpisodicRecord } from '../shared/types/memory';

// 相手のトーン導出(2026-06-21・旧 mood 機構を簡素化して後継。ファイル名も mood.ts → user-tone.ts へ)。
//
// 「相手の波長」= 直近の user episodic の valence(相手側の感情トーン)の recency 平均。
//  - canon(provenance:'self')は対象外(相手のトーンではない)。
//  - 中立プライア(USER_TONE_PRIOR_WEIGHT)で 0 へ縮約 → 記憶が少ない/古いと 0(=落ち込み扱いしない)。
//  - 旧版の非対称τ・暗転床・clampMood は撤去済み(効果ゼロ＋複雑性のため・simplify)。
//  - 状態は貯めない(毎ターン記憶から導出)=§5.3 適合。
// 使い道:retriever の「元気づけ」=トーンが負(相手が落ち込み気味)のとき、相手が楽しそうに語った
//   (正valence)記憶を想起で引き上げる(mood"一致"ではなく"逆"=companion 向き)。

/**
 * 直近の user episodic から相手のトーン(-2..+2 目安)を導出する。now は注入(テスト決定化)。
 * canon・日付不正・valence 欠落(=0)は安全に扱う。記憶が無ければ 0(中立)。
 * 分母に中立プライアを足すことで、記憶が古い/少ないほど 0 へ寄る。
 */
export function recentUserTone(records: EpisodicRecord[], nowMs: number): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const { memory } of records) {
    if (memory.provenance === 'self') continue; // canon は相手のトーンではない(§3.2)
    const t = Date.parse(memory.date);
    if (Number.isNaN(t)) continue;
    const deltaDays = Math.max(0, (nowMs - t) / DAY_MS);
    const w = Math.exp(-deltaDays / USER_TONE_TAU_DAYS);
    weightedSum += w * (memory.valence ?? 0);
    weightTotal += w;
  }
  return weightedSum / (weightTotal + USER_TONE_PRIOR_WEIGHT);
}

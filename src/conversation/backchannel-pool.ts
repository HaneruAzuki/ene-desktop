import type { BackchannelCue, BackchannelPoolData } from '../shared/types/backchannel';

// 相槌の語選択(task_18 Phase A・純粋ロジック・RNG 注入)。
// キャラ依存の語彙は characters/{id}/backchannels.json に外出し(§4.5)。ロード(I/O)は配線層(Phase B)で行う。

/** continuer が空のときの最終フォールバック(語プールが壊れていても無言にしない)。 */
const FALLBACK = 'うん';

/**
 * 指定の型から相槌語を1つ選ぶ。
 *  - 型の候補が空なら continuer にフォールバック、それも空なら FALLBACK。
 *  - 直前と同じ語(avoid)は可能なら避ける(反復回避)。
 * @param rng 0..1 の乱数(注入=テストで決定化)。
 */
export function selectBackchannel(
  pool: BackchannelPoolData,
  cue: BackchannelCue,
  rng: () => number,
  avoid?: string,
): string {
  const candidates = pickCandidates(pool, cue);
  if (candidates.length === 0) return FALLBACK;

  // 反復回避: avoid を除いた候補があればそちらから選ぶ。
  const pool2 = candidates.length > 1 ? candidates.filter((w) => w !== avoid) : candidates;
  const list = pool2.length > 0 ? pool2 : candidates;

  const idx = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[idx] ?? FALLBACK;
}

/** 型の候補語を返す(空なら continuer へフォールバック)。 */
function pickCandidates(pool: BackchannelPoolData, cue: BackchannelCue): string[] {
  const direct = pool.cues[cue];
  if (direct && direct.length > 0) return direct;
  const continuer = pool.cues.continuer;
  return continuer && continuer.length > 0 ? continuer : [];
}

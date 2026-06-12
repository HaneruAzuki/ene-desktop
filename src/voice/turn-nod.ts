import {
  TURN_NOD_LONG_THRESHOLD_MS,
  TURN_NOD_STRENGTH_SHORT,
  TURN_NOD_STRENGTH_LONG,
} from '../shared/constants';

// ターン終端うなずきの深さ算出(2026-06-12・ターンテイキングの視覚信号)。
// 無音窓終端(VAD endTurn)で1回うなずく深さを、直前の発話の長さ(ms)から決める純粋関数。
//   短い発話 = 情報量が少なく相手も即理解 → 軽いうなずき
//   長い発話(閾値以上)= 情報量が多く「一拍考えてから答える」所作 → 重めのうなずき
// 純粋関数=単体テスト対象(発火配線は vad-runtime、表現は vrm-renderer / CharacterDisplay)。

/** 発話長(ms)→ うなずきの深さ(相槌の基準 1.0 比)。閾値で2段階(軽い/重め)。 */
export function turnNodStrength(speechMs: number): number {
  return speechMs >= TURN_NOD_LONG_THRESHOLD_MS ? TURN_NOD_STRENGTH_LONG : TURN_NOD_STRENGTH_SHORT;
}

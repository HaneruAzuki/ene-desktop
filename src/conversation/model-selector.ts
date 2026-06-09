import { GENERATION_LONG_UTTERANCE_CHARS } from '../shared/constants';
import type { RouterResult } from '../shared/types/router';
import type { DomainLevel } from '../shared/types/character';

// 二段生成のモデル選択(B-15b)。雑談=Haiku(速い・安い)/ 難題=Sonnet(品質・一貫性)。
//
// 保守原則「迷ったら Sonnet」: キャラ一貫性(成功基準8=AIっぽくない)を最優先で守るため、
// 自信が持てない/重要なターンは高品質側(Sonnet)へ倒す。Haiku に回すのは「軽い雑談」だけ。
// 判定は B-15a のローカル判別器の domain を主軸に、発話長で補正する(純粋関数=単体テスト対象)。

export type ModelTier = 'haiku' | 'sonnet';

/**
 * Sonnet に倒す domain。high=専門(技術的正しさ＋得意げの機微)、refuse=安全(誤った許容を避ける)。
 * medium/low/none(一般・軽い困惑)は Haiku 候補。none(困惑)が Haiku で崩れるなら将来ここへ追加して調整。
 */
const SONNET_DOMAINS: readonly DomainLevel[] = ['high', 'refuse'];

/**
 * このターンの生成モデル tier を決める(純粋)。
 * - high / refuse → Sonnet
 * - 長い/複雑な発話(GENERATION_LONG_UTTERANCE_CHARS 超)→ Sonnet
 * - それ以外(medium/low/none の短い雑談)→ Haiku
 */
export function chooseModelTier(routerResult: RouterResult, userText: string): ModelTier {
  if (SONNET_DOMAINS.includes(routerResult.domain)) return 'sonnet';
  if (userText.trim().length > GENERATION_LONG_UTTERANCE_CHARS) return 'sonnet';
  return 'haiku';
}

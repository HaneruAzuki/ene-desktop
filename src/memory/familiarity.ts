import { FAMILIARITY_THRESHOLDS } from '../shared/constants';
import type { RelationshipFacts } from '../shared/types/character';

// 親しさ段階の導出(task_16・開示ゲーティング・design-revision-character-heart §4.2)。
//
// 「親しさ」は**感情スカラー(好感度)ではなく接触の事実**から導出する(§5.3 適合)。
//  - 経過日数 AND 会話実日数 AND ターン累計の **全部** が閾値を満たした最大段(1..5)。
//  - 事実は単調増加なので段も**単調非減少**(知り合った仲は戻らない=ドゥームループ無縁)。
//  - 保存スカラーは持たない。事実(active-character.json の relationship)から毎回導出する。

const DAY_MS = 86_400_000;

/**
 * 関係の事実から familiarityStage(1..5)を導出する。now は注入(テスト決定化)。
 * facts 不在(初対面)は 1。
 */
export function deriveFamiliarityStage(
  facts: RelationshipFacts | undefined,
  nowMs: number,
): number {
  if (!facts) return 1;
  const firstMet = Date.parse(facts.firstMetAt);
  const daysSince = Number.isNaN(firstMet) ? 0 : Math.max(0, (nowMs - firstMet) / DAY_MS);
  const talkDays = facts.distinctConversationDays ?? 0;
  const turns = facts.totalTurns ?? 0;

  let stage = 1;
  for (const t of FAMILIARITY_THRESHOLDS) {
    if (daysSince >= t.days && talkDays >= t.talkDays && turns >= t.turns) {
      stage = t.stage; // 閾値は昇順なので、満たした最後=最大段
    }
  }
  return stage;
}

import { KNOWLEDGE_GAP_GATES, KNOWLEDGE_GAP_SURFACE_MAX } from '../shared/constants';
import type { SemanticMemory } from '../shared/types/memory';

// 知識ギャップ(P5・N-PRES-5)。「まだ知らない相手の属性」を、親しさ段階のゲート付きで選ぶ。
//
// 設計意図:普通のアプリのように入力フォームで埋めさせない。人間が少しずつ相手を知るように、
// 親しくなるほど踏み込んだ属性(名前→読み/好きなもの→誕生日)を**自然な流れがあれば一つだけ**聞く。
// 段階(familiarityStage)は接触の事実から導出(FAMILIARITY_THRESHOLDS)=これも開示ゲートの鏡像。
// 純粋関数=I/O なし・決定論で単体テスト可能。

/** スロットが既に埋まっているか(埋まっていれば聞かない)。 */
function isSlotFilled(semantic: SemanticMemory, slot: string): boolean {
  switch (slot) {
    case 'userName':
      return Boolean(semantic.userName);
    case 'userNameReading':
      // 読みは「名前を知っていて、かつ読みがまだ」のときだけ意味がある。
      // 名前未知なら userName ゲート(先頭・stage1)が先に出るため、ここは名前既知前提で判定。
      return Boolean(semantic.userNameReading) || !semantic.userName;
    case 'likes':
      return Boolean(semantic.preferences && Object.keys(semantic.preferences).length > 0);
    case 'userBirthday':
      return Boolean(semantic.userBirthday);
    default:
      return true; // 未知スロットは「埋まっている」扱い=聞かない(安全側)
  }
}

/**
 * いま聞いてよい知識ギャップのラベルを返す(最大 KNOWLEDGE_GAP_SURFACE_MAX 件)。
 * ゲートの順(名前→読み/好きなもの→誕生日)に走査し、段階を満たし & 未充足のものを拾う。
 */
export function selectKnowledgeGaps(semantic: SemanticMemory, stage: number): string[] {
  const gaps: string[] = [];
  for (const gate of KNOWLEDGE_GAP_GATES) {
    if (stage < gate.minStage) continue;
    if (isSlotFilled(semantic, gate.slot)) continue;
    gaps.push(gate.label);
    if (gaps.length >= KNOWLEDGE_GAP_SURFACE_MAX) break;
  }
  return gaps;
}

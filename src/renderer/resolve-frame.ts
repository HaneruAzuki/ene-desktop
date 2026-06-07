import type { CharacterAnimationData, CharacterState } from '../shared/types/animation';

// 状態→フレーム名の解決(task_13・F-ANIM・純粋関数=単体テスト対象)。
//
// 解決順(設計則③ 手がかりの一貫性: **talking 中も emotion を保持**する):
//  1. thinking      → map.thinking(無ければ neutral base)
//  2. talking       → 実効 emotion の baseOpen(flap 開)/ base(flap 閉)→ 口だけ開閉・表情は保持
//  3. idle + sofa   → map.sofa(無ければ neutral base)
//  4. idle (stand)  → 実効 emotion の base
//
// 「実効 emotion」= base に存在する emotion。未対応(例 surprise・base 未定義)は neutral へ寄せてから
// 開閉を解決する(→ 未対応でも口が動く)。戻り値はフレーム「名(key)」。

function effectiveEmotion(anim: CharacterAnimationData, emotion: string): string {
  return anim.map.base[emotion as keyof typeof anim.map.base] ? emotion : 'neutral';
}

/** どのフレームも引けない異常時の最終フォールバック(存在する最初のフレーム名)。 */
function firstFrame(anim: CharacterAnimationData): string {
  return Object.keys(anim.frames)[0] ?? '';
}

export function resolveFrame(
  anim: CharacterAnimationData,
  state: CharacterState,
  flapOpen: boolean,
): string {
  const eff = effectiveEmotion(anim, state.emotion);
  const baseKey = anim.map.base[eff as keyof typeof anim.map.base];
  const neutralKey = anim.map.base.neutral;

  if (state.activity === 'thinking') {
    return anim.map.thinking ?? neutralKey ?? firstFrame(anim);
  }

  if (state.activity === 'talking') {
    const closed = baseKey ?? neutralKey ?? firstFrame(anim);
    if (flapOpen) {
      const open = anim.map.baseOpen?.[eff as keyof typeof anim.map.base];
      return open ?? closed; // baseOpen が無い emotion は閉じのまま(口は動かない)
    }
    return closed;
  }

  // idle
  if (state.pose === 'sofa') {
    return anim.map.sofa ?? neutralKey ?? firstFrame(anim);
  }
  return baseKey ?? neutralKey ?? firstFrame(anim);
}

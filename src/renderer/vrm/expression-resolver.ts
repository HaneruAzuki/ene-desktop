import type { EmotionLabel } from '../../shared/types/animation';
import type { VrmExpressionMap } from '../../shared/types/vrm';

// emotion → VRM 表情プリセットの重み解決(純粋関数=単体テスト対象)。
//
// ハーネス(scripts/vrm-harness.html)の applyEmotion に倣う:
//  - 管理対象=マップの値のうち 'neutral' 以外のプリセット名(重複排除)。
//  - 指定 emotion の対応プリセットだけ weight=1、他の管理対象は 0。
//  - emotion が neutral / 未マップ / 'neutral' を指す場合は全て 0(=素の顔)。
// これにより「どの emotion がどの表情か」をコードに埋め込まず JSON 駆動にする(§4.5/§5.1)。

/** マップが扱う VRM 表情プリセット名の集合(neutral を除く・重複排除)。 */
export function managedPresets(map: VrmExpressionMap): string[] {
  const set = new Set<string>();
  for (const preset of Object.values(map)) {
    if (preset && preset !== 'neutral') set.add(preset);
  }
  return [...set];
}

/**
 * emotion に対する全管理プリセットの重みを返す(active=1・他=0)。
 * 戻り値をそのまま expressionManager.setValue(name, weight) へ流せる。
 */
export function resolveExpressionWeights(
  map: VrmExpressionMap,
  emotion: EmotionLabel,
): Record<string, number> {
  const presets = managedPresets(map);
  const active = map[emotion];
  const weights: Record<string, number> = {};
  for (const p of presets) {
    weights[p] = active && active !== 'neutral' && p === active ? 1 : 0;
  }
  return weights;
}

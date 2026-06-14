// アニメ状態機械の型定義(task_13・F-ANIM)。
//
// emotion ラベルは「層間の契約」として全キャラ共通でコードに固定する(EMOTION_LABELS)。
// 見た目(どのスプライトか)は animation.json、口調は few-shot に置く(キャラ依存値の外出し・§5.1)。

export const EMOTION_LABELS = [
  'neutral',
  'joy',
  'anger',
  'sorrow',
  'surprise',
  'embarrassed',
] as const;
export type EmotionLabel = (typeof EMOTION_LABELS)[number];

export type CharacterActivity = 'idle' | 'thinking' | 'talking';
export type CharacterPose = 'stand' | 'sofa';

/** Renderer が保持する単一の表示状態(数値の感情蓄積は持たない・§5.3)。 */
export interface CharacterState {
  activity: CharacterActivity;
  emotion: EmotionLabel;
  pose: CharacterPose;
}

// PNG 立ち絵フォールバック(アニメ・フレーム差し替え)の型は 2026-06 に撤去した(表示は VRM 一本)。

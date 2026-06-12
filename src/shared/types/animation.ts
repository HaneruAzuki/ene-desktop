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

/** animation.json のタイミング定義(数値は一元管理・F-ANIM-12)。 */
export interface AnimationTiming {
  mouthFlapMs?: number;
  idleSwayMs?: number;
  sofaAfterIdleMs?: number;
}

/** 状態→フレームの対応表。 */
export interface AnimationMap {
  base: Partial<Record<EmotionLabel, string>>; // emotion → 口閉じフレーム名
  baseOpen?: Partial<Record<EmotionLabel, string>>; // emotion → 口開きフレーム名(talking 用・任意)
  thinking?: string; // 考え中(任意・無ければ neutral)
  sofa?: string; // 寝そべり(idle 専用・任意・無ければ neutral)
}

/** animation.json のスキーマ(F-ANIM-02)。 */
export interface CharacterAnimation {
  characterId: string;
  frameSize: { width: number; height: number };
  // フレーム名 → 画像ファイル名({id}/ 配下。task_13 D1: sprites/ サブdirは作らない)
  frames: Record<string, string>;
  map: AnimationMap;
  timing?: AnimationTiming;
}

/** Renderer へ渡すアニメ(frames を base64 dataURL 化したもの・IPC 用)。 */
export interface CharacterAnimationData {
  frameSize: { width: number; height: number };
  frames: Record<string, string>; // フレーム名 → dataURL
  map: AnimationMap;
  timing?: AnimationTiming;
}

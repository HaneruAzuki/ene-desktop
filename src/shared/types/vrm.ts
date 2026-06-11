import type { EmotionLabel } from './animation';

// VRM 表示の型(F・3D化)。
//
// 立ち絵(animation.json)と同じく「キャラ依存値は JSON 外出し」原則(§4.5/§5.1)に従い、
// 感情→表情プリセットの対応・初期表示パラメータ・モデルファイル名は characters/{id}/vrm.json に持つ。
// コードには「どの emotion がどの VRM 表情か」を一切ハードコードしない。

/** emotion ラベル → VRM 表情プリセット名(happy/angry/sad/relaxed/surprised 等)の対応。 */
export type VrmExpressionMap = Partial<Record<EmotionLabel, string>>;

/**
 * 表示の調整パラメータ(バストアップのフレーミング・体の向き・腕の下げ)。
 * 値はハーネス(scripts/vrm-harness.html)で実証した初期値を既定とする。
 */
export interface VrmDisplayParams {
  /** カメラ高さのパン(+で見上げ・-で見下ろし)。 */
  height: number;
  /** カメラ距離(小さいほど寄る)。 */
  distance: number;
  /** 体の向き Y(度)。正面=0、右斜め向き=正。 */
  yawDeg: number;
  /** 上腕を下ろす角度(度)。T ポーズから腕を下げる量。 */
  armDownDeg: number;
}

/** 既定の表示パラメータ(vrm.json に display が無い/欠けるときのフォールバック)。 */
export const DEFAULT_VRM_DISPLAY: VrmDisplayParams = {
  height: 0,
  distance: 0.55,
  yawDeg: 18,
  armDownDeg: 62,
};

/** characters/{id}/vrm.json のスキーマ。 */
export interface VrmConfig {
  characterId: string;
  /** モデルファイル名(characters/{id}/ 配下。例 "torimi.vrm")。 */
  model: string;
  expressionMap: VrmExpressionMap;
  display: VrmDisplayParams;
}

/**
 * Renderer へ渡す VRM 設定(モデルのバイト列は別 IPC=getCharacterModel で取得するため含めない)。
 * display はユーザー上書き(app-settings)をマージ済みの実効値。
 */
export interface VrmRenderConfig {
  expressionMap: VrmExpressionMap;
  display: VrmDisplayParams;
}

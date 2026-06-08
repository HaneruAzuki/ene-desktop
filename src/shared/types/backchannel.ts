// 能動的リスニング(相槌・思考フィラー)の型定義(task_18)。
// キャラ依存値(相槌の語彙)は characters/{id}/backchannels.json に外出し(§4.5)。
//
// 相槌=聞くターン(ユーザの番)の振る舞い。思考フィラー=答える入り(熟考時)の声。
// リアルタイム判定は完全ローカル・純粋ロジック(Claude/ネットワークを置かない・task_18 設計の憲法)。

/**
 * 相槌の型(韻律・文脈に応じて打ち分ける)。
 * Phase A は continuer 既定。韻律(RMS)による型選択は Phase B 以降。
 */
export type BackchannelCue = 'continuer' | 'understanding' | 'surprise' | 'empathy';

/** characters/{id}/backchannels.json のスキーマ。型→語の配列＋思考フィラー。 */
export interface BackchannelPoolData {
  version: number;
  /** 型→相槌語の候補。continuer を必須フォールバックとする。 */
  cues: Partial<Record<BackchannelCue, string[]>>;
  /** 答える入りの思考フィラー(「うーん」等・Phase C)。 */
  thinkingFiller?: string[];
}

/**
 * リアルタイム・エンジンが「今うつ」と判断したときの出力(聞くターンの相槌)。
 * 実際の語の選択は selectBackchannel(語プール)で行う。
 */
export interface BackchannelDecision {
  kind: 'backchannel';
  cue: BackchannelCue;
  /** デバッグ/調律用: 直近ピーク/平常 のエネルギー比(Lv2・韻律による型選択)。 */
  energyRatio?: number;
  /** デバッグ/調律用: 直近の発話ピーク(絶対RMS)。 */
  energyPeak?: number;
  /** デバッグ/調律用: 平常エネルギー(絶対RMS・長期平均)。 */
  energyBaseline?: number;
  /** デバッグ/調律用: 直近ピッチ/平常 のピッチ比(Lv2・主信号)。 */
  pitchRatio?: number;
  /** デバッグ/調律用: 直近の発話ピッチ山(Hz)。 */
  pitchPeak?: number;
  /** デバッグ/調律用: 平常ピッチ(Hz・長期平均)。 */
  pitchBaseline?: number;
  /** デバッグ/調律用: 判定に使った自己キャリブレーション閾値(ピッチ・Lv2)。 */
  pitchThreshold?: number;
  /** デバッグ/調律用: 判定に使った自己キャリブレーション閾値(エネルギー・Lv2)。 */
  energyThreshold?: number;
}

// 能動的リスニング(相槌・思考フィラー)の型定義(task_18)。
// キャラ依存値(相槌の語彙)は {id}/backchannels.json に外出し(§4.5)。
//
// 相槌=聞くターン(ユーザの番)の振る舞い。思考フィラー=答える入り(熟考時)の声。
// リアルタイム判定は完全ローカル・純粋ロジック(Claude/ネットワークを置かない・task_18 設計の憲法)。

/**
 * 相槌の型。**現行は continuer のみ出力する**(韻律トーン判定 Lv2=surprise 等の打ち分けは
 * 2026-06-10 に撤去。docs/archive/design-revision-backchannel-prosody-lv2.md)。
 * 型の他値・cues スキーマは将来の多型相槌復活に備えて温存している。
 */
export type BackchannelCue = 'continuer' | 'understanding' | 'surprise' | 'empathy';

/** {id}/backchannels.json のスキーマ。型→語の配列＋思考フィラー。 */
export interface BackchannelPoolData {
  version: number;
  /** 型→相槌語の候補。continuer を必須フォールバックとする。 */
  cues: Partial<Record<BackchannelCue, string[]>>;
  /** 答える入りの思考フィラー(「そうね」等・Phase C)。 */
  thinkingFiller?: string[];
  /** 語ごとのアクセント下げ位置の上書き(text→accent)。例「そうね」=1 で平板→頭高下降。合成時に audio_query へ反映。 */
  accents?: Record<string, number>;
}

/**
 * リアルタイム・エンジンが「今うつ」と判断したときの出力(聞くターンの相槌)。
 * 実際の語の選択は selectBackchannel(語プール)で行う。
 * 韻律(F0/エネルギー比)の調律フィールドは Lv2 撤去に伴い削除した(2026-06-10)。
 */
export interface BackchannelDecision {
  kind: 'backchannel';
  cue: BackchannelCue;
}

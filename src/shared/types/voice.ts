import type { EmotionLabel } from './animation';

// 音声(TTS)レイヤーの型定義(task_17 / design-revision-voice §4)。
// キャラ依存値(声・スタイル・パラメータ)は {id}/voice.json に外出し(§4.5)。

/**
 * 1スタイル(感情)の合成パラメータ。
 * 声の高さ/個性は基本「モデル選択＋スタイル」で決める。`pitchScale` は AivisSpeech で
 * 大きく動かすと音質劣化するため**小さく(微調整に限り)使う**(声の高さの微調整・任意)。
 */
export interface VoiceStyleParams {
  styleId: number; // エンジンの話者/スタイルID(/speakers 由来)
  speedScale?: number; // 話速
  pitchScale?: number; // 声の高さ(0=基準・負で低く)。AivisSpeech では小さい値のみ使う(劣化回避)
  intonationScale?: number; // 抑揚(選択スタイルの感情の強さ)
  tempoDynamicsScale?: number; // 緩急(AivisSpeech 固有)
  volumeScale?: number; // 音量
  /** アクセント下げ位置の上書き(1-indexed・最後の accent_phrase に適用)。相槌/フィラーの語ごと調律用(任意)。 */
  accent?: number;
}

/**
 * 出力音声の声色補正(EQ)の1バンド。Web Audio の BiquadFilterNode に1対1で対応する。
 * **声の高さ(F0)は変えず、音色(明るさ/太さ)だけを整える**ため、ピッチシフト由来の劣化が出ない
 * (AivisSpeech の pitchScale を強めると劣化する問題の回避策・voice.ts 上部 §参照)。
 * キャラ依存値なので voice.json に外出し(§4.5)。実行時は renderer の再生グラフへ直列に挟む。
 */
export interface EqBand {
  type: 'lowshelf' | 'highshelf' | 'peaking' | 'lowpass' | 'highpass'; // フィルタ種別
  frequency: number; // 中心/コーナー周波数(Hz)
  gain?: number; // 増減(dB・lowshelf/highshelf/peaking のみ・負で減衰=落ち着き)
  q?: number; // Q(peaking/lowpass/highpass の鋭さ・任意)
}

/** {id}/voice.json のスキーマ。emotion ラベル→スタイル/パラメータ。 */
export interface VoiceConfig {
  engine: string; // 'aivisspeech' 等(将来 VOICEVOX 等へ差し替え)
  baseUrl: string; // ローカル API(例 http://127.0.0.1:10101)
  model?: string; // 採用音声モデル識別(任意・記録用)
  /**
   * AIVM モデルの UUID(.aivmx に埋め込まれた識別子)。標準版 AivisSpeech が同居する環境で、
   * エンジンの Models へ `<uuid>.aivmx` をハードリンクで持ち込むために使う(N-17-13・ポータブル化)。
   * キャラ依存値ゆえコードにハードコードせず voice.json に外出しする(§4.5)。
   */
  uuid?: string;
  credit?: string; // 必須ライセンス文言(about/クレジット画面に常時表示・つくよみコーパス規約)
  styles: Partial<Record<EmotionLabel, VoiceStyleParams>>; // neutral は必須(フォールバック先)
  eq?: EqBand[]; // 出力音声の音色補正(任意・声を落ち着かせる等。F0 は変えない=劣化なし)
}

/** TtsEngine.speak へ渡す解決済みオプション(VoiceStyleParams と同形)。 */
export type TtsOptions = VoiceStyleParams;

/** エンジンが返すスタイル一覧(/speakers 相当)。 */
export interface TtsStyle {
  name: string; // 表示名(例 "つくよみちゃん/ノーマル")
  styleId: number;
}

/**
 * 合成エンジン(§4.4 疎結合:VOICEVOX/AivisSpeech/将来別実装を差し替え可能)。
 * 実装は localhost のローカル API を叩く(外部通信ではない・§4.2維持)。
 */
export interface TtsEngine {
  /**
   * 1文を合成して音声バイト(WAV)を返す。
   * signal: 中断(ターンの supersede / barge-in)。abort されたら進行中の合成 HTTP を打ち切り、
   * 捨てたはずの合成がエンジンに残って後続を詰まらせない(single-flight・連続リクエストの輻輳防止)。
   */
  speak(text: string, opts: TtsOptions, signal?: AbortSignal): Promise<ArrayBuffer>;
  /** 利用可能なスタイル一覧を取得(/speakers)。 */
  listStyles(): Promise<TtsStyle[]>;
}

import type { EmotionLabel } from './animation';

// 音声(TTS)レイヤーの型定義(task_17 / design-revision-voice §4)。
// キャラ依存値(声・スタイル・パラメータ)は characters/{id}/voice.json に外出し(§4.5)。

/**
 * 1スタイル(感情)の合成パラメータ。
 * `pitchScale` は AivisSpeech で 0 から動かすと音質劣化するため**持たない**(design-revision-voice §4)。
 * 声の高さ/個性は「モデル選択＋スタイル」で決める。
 */
export interface VoiceStyleParams {
  styleId: number; // エンジンの話者/スタイルID(/speakers 由来)
  speedScale?: number; // 話速
  intonationScale?: number; // 抑揚(選択スタイルの感情の強さ)
  tempoDynamicsScale?: number; // 緩急(AivisSpeech 固有)
  volumeScale?: number; // 音量
  /** アクセント下げ位置の上書き(1-indexed・最後の accent_phrase に適用)。相槌/フィラーの語ごと調律用(任意)。 */
  accent?: number;
}

/** characters/{id}/voice.json のスキーマ。emotion ラベル→スタイル/パラメータ。 */
export interface VoiceConfig {
  engine: string; // 'aivisspeech' 等(将来 VOICEVOX 等へ差し替え)
  baseUrl: string; // ローカル API(例 http://127.0.0.1:10101)
  model?: string; // 採用音声モデル識別(任意・記録用)
  credit?: string; // 必須ライセンス文言(about/クレジット画面に常時表示・つくよみコーパス規約)
  styles: Partial<Record<EmotionLabel, VoiceStyleParams>>; // neutral は必須(フォールバック先)
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
  /** 1文を合成して音声バイト(WAV)を返す。 */
  speak(text: string, opts: TtsOptions): Promise<ArrayBuffer>;
  /** 利用可能なスタイル一覧を取得(/speakers)。 */
  listStyles(): Promise<TtsStyle[]>;
}

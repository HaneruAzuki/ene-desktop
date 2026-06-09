import {
  VAD_FRAME_SIZE,
  VAD_SPEECH_THRESHOLD,
  VAD_SILENCE_THRESHOLD,
  VAD_MIN_SILENCE_MS,
  VAD_MIN_SPEECH_MS,
  VAD_BARGE_IN_MIN_SPEECH_MS,
  STT_SAMPLE_RATE,
} from '../shared/constants';

// 発話確率の列 → speech-start / speech-end イベント化(task_17 Phase C)。
// ヒステリシス(上/下しきい値)＋最小発話(開始デバウンス)＋最小無音(終了判定)。
// 純粋ロジック(I/O も乱数も持たない)=単体テスト対象。

export type VadEvent = 'speech-start' | 'speech-end';

export interface VadSegmenterConfig {
  sampleRate: number;
  frameSize: number;
  speechThreshold: number;
  silenceThreshold: number;
  minSilenceMs: number;
  /** 通常時の発話開始デバウンス。 */
  minSpeechMs: number;
  /** ENE 発話中(barge-in 検出)の発話開始デバウンス。エコー残響での誤割り込みを抑えるため長め。 */
  bargeInMinSpeechMs: number;
}

export const DEFAULT_VAD_CONFIG: VadSegmenterConfig = {
  sampleRate: STT_SAMPLE_RATE,
  frameSize: VAD_FRAME_SIZE,
  speechThreshold: VAD_SPEECH_THRESHOLD,
  silenceThreshold: VAD_SILENCE_THRESHOLD,
  minSilenceMs: VAD_MIN_SILENCE_MS,
  minSpeechMs: VAD_MIN_SPEECH_MS,
  bargeInMinSpeechMs: VAD_BARGE_IN_MIN_SPEECH_MS,
};

export class VadSegmenter {
  private triggered = false;
  private speechFrames = 0; // 連続発話フレーム(開始デバウンス)
  private silenceFrames = 0; // 連続無音フレーム(終了判定)
  private readonly frameMs: number;
  private minSilenceFrames: number; // ターン終了の無音フレーム数(コアレッシング適応で実行時に変わる)
  private minSpeechFrames: number;

  constructor(private readonly cfg: VadSegmenterConfig = DEFAULT_VAD_CONFIG) {
    this.frameMs = (cfg.frameSize / cfg.sampleRate) * 1000;
    this.minSilenceFrames = Math.max(1, Math.round(cfg.minSilenceMs / this.frameMs));
    this.minSpeechFrames = Math.max(1, Math.round(cfg.minSpeechMs / this.frameMs));
  }

  /**
   * ターン終了とみなす無音(ms)を実行時に更新する(コアレッシングの適応・段階②)。
   * 現在の発話/無音カウントは保持する(進行中のターン判定を壊さない)。
   */
  setMinSilenceMs(ms: number): void {
    this.minSilenceFrames = Math.max(1, Math.round(ms / this.frameMs));
  }

  /**
   * barge-in 用の厳しめデバウンスに切替える(ENE 発話中=エコー誤発火を抑える)。
   * 通常の聞き取りに戻すときは false。
   */
  setStrict(strict: boolean): void {
    const ms = strict ? this.cfg.bargeInMinSpeechMs : this.cfg.minSpeechMs;
    this.minSpeechFrames = Math.max(1, Math.round(ms / this.frameMs));
    this.speechFrames = 0; // 切替時はデバウンスをやり直す
  }

  /** 1フレームの確率を投入。状態遷移が起きたらイベントを返す(無ければ null)。 */
  push(prob: number): VadEvent | null {
    if (!this.triggered) {
      if (prob >= this.cfg.speechThreshold) {
        this.speechFrames++;
        if (this.speechFrames >= this.minSpeechFrames) {
          this.triggered = true;
          this.silenceFrames = 0;
          return 'speech-start';
        }
      } else {
        this.speechFrames = 0;
      }
      return null;
    }
    // 発話中: 下しきい値を下回る無音が一定時間続いたら終了。
    if (prob < this.cfg.silenceThreshold) {
      this.silenceFrames++;
      if (this.silenceFrames >= this.minSilenceFrames) {
        this.triggered = false;
        this.speechFrames = 0;
        this.silenceFrames = 0;
        return 'speech-end';
      }
    } else {
      this.silenceFrames = 0; // 無音が途切れたらリセット(発話継続)
    }
    return null;
  }

  reset(): void {
    this.triggered = false;
    this.speechFrames = 0;
    this.silenceFrames = 0;
  }

  get isSpeaking(): boolean {
    return this.triggered;
  }
}

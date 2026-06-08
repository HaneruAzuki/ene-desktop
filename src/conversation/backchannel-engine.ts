import {
  VAD_FRAME_SIZE,
  VAD_SPEECH_THRESHOLD,
  VAD_SILENCE_THRESHOLD,
  VAD_MIN_SILENCE_MS,
  STT_SAMPLE_RATE,
  BACKCHANNEL_MIN_SPEECH_MS,
  BACKCHANNEL_MIN_INTERVAL_MS,
  BACKCHANNEL_PAUSE_TRIGGER_MS,
} from '../shared/constants';
import type { BackchannelDecision } from '../shared/types/backchannel';

// 相槌タイミングのリアルタイム判定(task_18 Phase A・聞くターン)。
// 既存 VadSegmenter と同じく「発話確率列 → イベント」の純粋ロジック(I/O も乱数も持たない=単体テスト対象)。
//
// 着眼: 人は相手が「ひと区切り(短い言いよどみ)」したところで相槌を打つ。
//   = 十分に続いた発話のあと、ターン終了には至らない短い無音(言いよどみ)を検出して発火。
//   発話確率(prob)の軌跡だけで判定でき、Claude もネットワークも要らない(完全ローカル)。
//
// 設計の憲法(task_18): 尺・有無は「良い聞き手とは」で決める。Claude が返るまでの時間では決めない。

export interface BackchannelEngineConfig {
  sampleRate: number;
  frameSize: number;
  speechThreshold: number;
  silenceThreshold: number;
  /** 最初の相槌までに必要な持続発話(ms)。 */
  minSpeechMs: number;
  /** 相槌の最小間隔(ms・頻度ガバナ)。 */
  minIntervalMs: number;
  /** 言いよどみが相槌スロットになる継続(ms)。 */
  pauseTriggerMs: number;
  /** ターン終了とみなす無音(ms)。これに達したら相槌でなく応答の入り=発火しない。 */
  turnEndMs: number;
}

export const DEFAULT_BACKCHANNEL_CONFIG: BackchannelEngineConfig = {
  sampleRate: STT_SAMPLE_RATE,
  frameSize: VAD_FRAME_SIZE,
  speechThreshold: VAD_SPEECH_THRESHOLD,
  silenceThreshold: VAD_SILENCE_THRESHOLD,
  minSpeechMs: BACKCHANNEL_MIN_SPEECH_MS,
  minIntervalMs: BACKCHANNEL_MIN_INTERVAL_MS,
  pauseTriggerMs: BACKCHANNEL_PAUSE_TRIGGER_MS,
  turnEndMs: VAD_MIN_SILENCE_MS,
};

export class BackchannelEngine {
  private readonly frameMs: number;
  /** 直近の連続発話の長さ(ms)。相槌を打つ/ターンが進むとリセット。 */
  private speechMs = 0;
  /** 現在の連続無音の長さ(ms)。発話復帰でリセット。 */
  private pauseMs = 0;
  /** 最後に相槌を打ってからの経過(ms・頻度ガバナ)。十分大きい値で開始(初手を妨げない)。 */
  private sinceLastMs: number;
  /** この言いよどみ区間で既に1回打ったか(1スロット1回)。 */
  private firedThisPause = false;
  /** 一度でも発話を観測したか(無音だけの間は相槌を打たない)。 */
  private speaking = false;

  constructor(private readonly cfg: BackchannelEngineConfig = DEFAULT_BACKCHANNEL_CONFIG) {
    this.frameMs = (cfg.frameSize / cfg.sampleRate) * 1000;
    this.sinceLastMs = cfg.minIntervalMs; // 初回はガバナで妨げない
  }

  /**
   * 1フレームの発話確率を投入。相槌を打つべきなら BackchannelDecision を返す(無ければ null)。
   * Phase A は型=continuer 固定(韻律による型選択は Phase B)。
   */
  push(prob: number): BackchannelDecision | null {
    this.sinceLastMs += this.frameMs;

    if (prob >= this.cfg.speechThreshold) {
      // 発話中: 言いよどみカウンタをリセットし、発話継続を積む。
      this.speaking = true;
      this.speechMs += this.frameMs;
      this.pauseMs = 0;
      this.firedThisPause = false;
      return null;
    }

    if (prob >= this.cfg.silenceThreshold) {
      // ヒステリシス帯(継続扱い)=無音にしない。
      return null;
    }

    // 無音(言いよどみ候補)。
    if (!this.speaking) return null; // まだ誰も話していない
    this.pauseMs += this.frameMs;

    const inSlot =
      this.pauseMs >= this.cfg.pauseTriggerMs && this.pauseMs < this.cfg.turnEndMs;
    const ready =
      !this.firedThisPause &&
      this.speechMs >= this.cfg.minSpeechMs &&
      this.sinceLastMs >= this.cfg.minIntervalMs;

    if (inSlot && ready) {
      this.firedThisPause = true;
      this.sinceLastMs = 0;
      this.speechMs = 0; // 次の相槌は発話の積み直しから(自然な間隔)
      return { kind: 'backchannel', cue: 'continuer' };
    }
    return null;
  }

  /** ターン境界等で状態を初期化(次の発話を 0 から数え直す)。 */
  reset(): void {
    this.speechMs = 0;
    this.pauseMs = 0;
    this.sinceLastMs = this.cfg.minIntervalMs;
    this.firedThisPause = false;
    this.speaking = false;
  }
}

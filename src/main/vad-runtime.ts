import type { BrowserWindow } from 'electron';
import { log } from '../shared/logger';
import { SileroVad } from '../conversation/silero-vad';
import { VadSegmenter } from '../conversation/vad-segmenter';
import { transcribe, isSttModelAvailable } from '../conversation/stt-transcriber';
import { VAD_FRAME_SIZE, VAD_SPEECH_PAD_MS, STT_SAMPLE_RATE } from '../shared/constants';

// ハンズフリー VAD ループ(main・task_17 Phase C)。
//
// renderer から連続フレーム(16kHz・512サンプル)を受け取り:
//   Silero v4 で発話確率 → セグメンタで speech-start/speech-end 判定
//   → 発話区間を蓄積 → 話し終わりで Whisper 文字起こし → 確定テキストを renderer へ。
// renderer はそのテキストを既存 sendMessage に流す(テキスト/push-to-talk と同じ会話経路)。
//
// barge-in: ENE 発話中(setSpeaking(true))に発話開始を検出したら renderer へ割り込み通知。
// best-effort(モデル未配置/失敗でもアプリは継続)。録音音声は外部送信せずローカル STT のみ(§7.1)。

/** 発話頭の取りこぼし防止に前置きするフレーム数(先読みパディング)。 */
const PREROLL_FRAMES = Math.ceil((VAD_SPEECH_PAD_MS / 1000) * STT_SAMPLE_RATE / VAD_FRAME_SIZE);
/** 録音の上限(暴走防止・約30秒)。 */
const MAX_RECORD_FRAMES = Math.ceil((30 * STT_SAMPLE_RATE) / VAD_FRAME_SIZE);

export class VadRuntime {
  private vad = new SileroVad();
  private seg = new VadSegmenter();
  private active = false;
  private loading: Promise<void> | null = null;
  private busy = false;
  private recording = false;
  private speaking = false; // ENE が発話中(barge-in 判定用)
  private recorded: Float32Array[] = [];
  private ring: Float32Array[] = []; // 直近フレーム(先読みパディング用)

  constructor(private readonly win: BrowserWindow) {}

  /** VAD セッション開始。モデル未配置なら false(呼び出し側は push-to-talk のまま)。 */
  async start(): Promise<boolean> {
    if (!(await isSttModelAvailable())) return false;
    this.seg.reset();
    this.vad.reset();
    this.recording = false;
    this.recorded = [];
    this.ring = [];
    this.speaking = false;
    if (!this.loading) this.loading = this.vad.load();
    try {
      await this.loading;
    } catch (e) {
      this.loading = null;
      log.warn(`VAD load failed: ${(e as Error).name}`);
      return false;
    }
    this.active = true;
    this.sendState('listening');
    return true;
  }

  stop(): void {
    this.active = false;
    this.recording = false;
    this.recorded = [];
    this.ring = [];
    this.seg.reset();
    this.vad.reset();
  }

  /** ENE 発話中フラグ。barge-in 検出を厳しめデバウンスに切替え、エコー誤割り込みを抑える。 */
  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    this.seg.setStrict(speaking);
  }

  /** 1フレーム処理。busy 中はドロップ(セッションの同時 run を避ける・実質発生しない)。 */
  async pushFrame(frame: Float32Array): Promise<void> {
    if (!this.active || this.busy) return;
    this.busy = true;
    try {
      // 先読みリング(発話前の数フレームを保持)。
      this.ring.push(frame);
      if (this.ring.length > PREROLL_FRAMES) this.ring.shift();
      if (this.recording) {
        this.recorded.push(frame);
        if (this.recorded.length > MAX_RECORD_FRAMES) this.endTurn(); // 暴走打ち切り
      }

      const prob = await this.vad.process(frame);
      const ev = this.seg.push(prob);
      if (ev === 'speech-start') this.onSpeechStart();
      else if (ev === 'speech-end') this.onSpeechEnd();
    } catch (e) {
      log.warn(`VAD frame failed: ${(e as Error).name}`);
    } finally {
      this.busy = false;
    }
  }

  private onSpeechStart(): void {
    if (this.speaking) {
      // ENE が喋っている最中の発話開始 = 割り込み。
      this.send('ene:voice-barge-in');
    }
    if (this.recording) return;
    this.recording = true;
    this.recorded = [...this.ring]; // 先読みパディング込みで開始
    this.sendState('recording');
  }

  private onSpeechEnd(): void {
    if (this.recording) this.endTurn();
  }

  /** 録音を確定し、非同期で文字起こし→テキストを renderer へ(フレーム処理はブロックしない)。 */
  private endTurn(): void {
    if (!this.recording) return;
    this.recording = false;
    const audio = concat(this.recorded);
    this.recorded = [];
    this.sendState('transcribing');
    void this.transcribeAndSend(audio);
  }

  private async transcribeAndSend(audio: Float32Array): Promise<void> {
    try {
      const text = await transcribe(audio);
      if (text && this.active) {
        log.info(`vad transcript (${text.length} chars)`); // §6.2: 本文は出さない
        this.send('ene:voice-transcript', text);
      } else {
        this.sendState('listening'); // 空認識 → 聞き取りに戻る
      }
    } catch (e) {
      log.warn(`vad transcribe failed: ${(e as Error).name}`);
      this.sendState('listening');
    }
  }

  private sendState(state: 'listening' | 'recording' | 'transcribing'): void {
    this.send('ene:voice-state', state);
  }

  private send(channel: string, payload?: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }
}

/** Float32 フレーム列を1本に連結する。 */
function concat(frames: Float32Array[]): Float32Array {
  let total = 0;
  for (const f of frames) total += f.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

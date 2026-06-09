import type { BrowserWindow } from 'electron';
import { performance } from 'node:perf_hooks';
import { log } from '../shared/logger';
import { SileroVad } from '../conversation/silero-vad';
import { VadSegmenter } from '../conversation/vad-segmenter';
import { frameRms, frameF0 } from '../conversation/backchannel-engine';
import { transcribe, isSttModelAvailable } from '../conversation/stt-transcriber';
import type { BackchannelController } from './backchannel-controller';
import {
  VAD_FRAME_SIZE,
  VAD_SPEECH_PAD_MS,
  VAD_MIN_SILENCE_MS,
  STT_SAMPLE_RATE,
} from '../shared/constants';

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

  // 相槌(task_18 Phase B・任意)。ユーザ発話中の言いよどみで相槌を打つ。
  // listenOnly: 相槌テスト用(env ENE_LISTEN_ONLY=1)。ターン終了時に文字起こし・応答(Claude/記憶)を
  //   スキップし、VAD＋相槌だけを動かす。レイテンシ問題と無関係に相槌の体感を検証できる。
  constructor(
    private readonly win: BrowserWindow,
    private readonly backchannel?: BackchannelController,
    private readonly listenOnly = false,
    // STT 確定テキストの後処理(名前誤認の保守補正など・任意)。STT 経路のみ・テキスト入力には適用しない。
    private readonly correctTranscript?: (text: string) => string,
  ) {}

  /** VAD セッション開始。モデル未配置なら false(呼び出し側は push-to-talk のまま)。 */
  async start(): Promise<boolean> {
    // listenOnly(相槌テスト)は Whisper を使わないので STT モデル無しでも開始できる。
    if (!this.listenOnly && !(await isSttModelAvailable())) return false;
    if (this.listenOnly) log.warn('VAD listen-only mode: responses disabled (backchannel test)');
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
    // 相槌の語彙を事前合成(best-effort・非ブロッキング)。初回 hands-free は数秒後に有効化される。
    void this.backchannel?.prepare();
    this.backchannel?.reset();
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
    this.backchannel?.reset();
    void this.backchannel?.save(); // 学習値を永続化(ハンズフリー終了時・Lv2b)
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
      // 相槌は「ユーザの番」だけ(ENE 発話中は自分の声へ相槌を打たない・エコー誤発火回避)。
      // rms(勢い)＋f0(声の高さ)も渡して韻律で型を出し分ける(Lv2・ピッチ主/エネルギー補助)。
      if (!this.speaking && this.backchannel) {
        this.backchannel.onFrame(prob, frameRms(frame), frameF0(frame));
      }
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
    this.backchannel?.reset(); // ターン終了=次の発話は相槌カウンタを 0 から
    if (this.listenOnly) {
      // 相槌テスト: 文字起こし・応答(Claude/記憶=レイテンシ源)をスキップし聞き取りに戻る。
      this.recorded = [];
      this.sendState('listening');
      return;
    }
    const audio = concat(this.recorded);
    this.recorded = [];
    this.sendState('transcribing');
    void this.transcribeAndSend(audio);
  }

  private async transcribeAndSend(audio: Float32Array): Promise<void> {
    // 計測:喋り終わり〜送信の"見えないレイテンシ"。stt=文字起こし時間。
    //   この前に必ず VAD_MIN_SILENCE_MS の無音待ちが入る(喋り終わってから死に時間=無音 + stt)。
    const t = performance.now();
    try {
      const raw = await transcribe(audio);
      // 名前誤認の保守補正(発話全体が名前エイリアスのときだけ自称へ・B-10 Part4)。STT 経路のみ。
      const text = this.correctTranscript ? this.correctTranscript(raw) : raw;
      if (text && this.active) {
        // §6.2: 本文は出さない(文字数と ms のみ)。
        log.info(
          `vad transcript (${text.length} chars, stt=${Math.round(performance.now() - t)}ms; ` +
            `+silence ${VAD_MIN_SILENCE_MS}ms before)`,
        );
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

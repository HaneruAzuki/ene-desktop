import type { BrowserWindow } from 'electron';
import { performance } from 'node:perf_hooks';
import { log } from '../shared/logger';
import { SileroVad } from '../conversation/silero-vad';
import { VadSegmenter, DEFAULT_VAD_CONFIG } from '../conversation/vad-segmenter';
import { frameRms } from '../conversation/backchannel-engine';
import { transcribe, isSttModelAvailable } from '../conversation/stt-transcriber';
import type { BackchannelController } from './backchannel-controller';
import {
  VAD_FRAME_SIZE,
  VAD_SPEECH_PAD_MS,
  VAD_MIN_SILENCE_MS,
  STT_SAMPLE_RATE,
} from '../shared/constants';

/**
 * コアレッシング(投機生成＋連結・段階①)の配線。ON のとき、話終わりを**暫定**扱いにし、
 * 短い無音(minSilenceMs)で投機生成を開始(onProvisionalEnd)、発話再開で静かにキャンセル(onResume)する。
 * 未指定(既定)なら従来どおり renderer へ確定テキストを送る経路になる。
 */
export interface CoalesceHooks {
  /** 発話開始(speech-start)。未コミット投機生成のキャンセル＋発話中フラグ。 */
  onSpeechStart: () => void;
  /** 発話終了(speech-end・STT 開始の直前)。発話中フラグを下ろす。 */
  onSpeechEnd: () => void;
  /** 暫定ターン終了(STT 完了テキスト)。連結＋(ユーザが黙っていれば)投機生成。 */
  onProvisionalEnd: (text: string) => void;
  reset: () => void;
  /** 暫定ターン終了とみなす無音(ms)。VadSegmenter の minSilence を上書きする。 */
  minSilenceMs: number;
}

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
  private seg: VadSegmenter;
  private active = false;
  private loading: Promise<void> | null = null;
  private busy = false;
  private recording = false;
  private speaking = false; // ENE が発話中(barge-in 判定用)
  private recorded: Float32Array[] = [];
  private ring: Float32Array[] = []; // 直近フレーム(先読みパディング用)

  // 取り込み診断(ENE_VAD_DEBUG=1・分断原因の切り分け・一時)。
  // 仮説: ScriptProcessorNode(512)が会話負荷でアンダーラン→ゼロ埋め(無音)の隙間→VADが終話誤確定。
  // zeroRms=取り込みがゼロ埋めしたフレーム数 / maxArrivalGap・stalls=メインスレッド停滞の指標。
  private readonly vadDebug = process.env['ENE_VAD_DEBUG'] === '1';
  private lastFrameAt = 0;
  private dbgFrames = 0;
  private dbgZeroFrames = 0;
  private dbgMaxGapMs = 0;
  private dbgGapStalls = 0; // 到着間隔が 64ms(=2フレーム)超だった回数

  // 相槌(task_18 Phase B・任意)。ユーザ発話中の言いよどみで相槌を打つ。
  // listenOnly: 相槌テスト用(env ENE_LISTEN_ONLY=1)。ターン終了時に文字起こし・応答(Claude/記憶)を
  //   スキップし、VAD＋相槌だけを動かす。レイテンシ問題と無関係に相槌の体感を検証できる。
  constructor(
    private readonly win: BrowserWindow,
    private readonly backchannel?: BackchannelController,
    private readonly listenOnly = false,
    // STT 確定テキストの後処理(名前誤認の保守補正など・任意)。STT 経路のみ・テキスト入力には適用しない。
    private readonly correctTranscript?: (text: string) => string,
    // コアレッシング(段階①・ENE_COALESCE)。指定時は話終わりを暫定扱いにして coordinator を駆動する。
    private readonly coalesce?: CoalesceHooks,
  ) {
    // コアレッシング時は暫定ターン終了を短く(投機生成を早く始める)。未指定なら既定(VAD_MIN_SILENCE_MS)。
    this.seg = coalesce
      ? new VadSegmenter({ ...DEFAULT_VAD_CONFIG, minSilenceMs: coalesce.minSilenceMs })
      : new VadSegmenter();
  }

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
    this.coalesce?.reset(); // 進行中の投機生成を中断し pending を空に(コアレッシング)
  }

  /** ENE 発話中フラグ。barge-in 検出を厳しめデバウンスに切替え、エコー誤割り込みを抑える。 */
  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    this.seg.setStrict(speaking);
  }

  /** 暫定ターン終了の無音窓(ms)を更新する(コアレッシングの適応・段階②・coordinator から呼ぶ)。 */
  setSilenceWindow(ms: number): void {
    this.seg.setMinSilenceMs(ms);
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
        if (this.vadDebug) {
          const now = performance.now();
          if (this.lastFrameAt) {
            const gap = now - this.lastFrameAt;
            if (gap > this.dbgMaxGapMs) this.dbgMaxGapMs = gap;
            if (gap > 64) this.dbgGapStalls++;
          }
          this.lastFrameAt = now;
          this.dbgFrames++;
          if (frameRms(frame) < 1e-4) this.dbgZeroFrames++; // ≈0 = 取り込みのゼロ埋め(無音)疑い
        }
        if (this.recorded.length > MAX_RECORD_FRAMES) this.endTurn(); // 暴走打ち切り
      }

      const prob = await this.vad.process(frame);
      // 相槌は「ユーザの番」だけ(ENE 発話中は自分の声へ相槌を打たない・エコー誤発火回避)。
      // タイミング判定のみ(韻律トーン判定 Lv2 は撤去・2026-06-10)。
      if (!this.speaking && this.backchannel) {
        this.backchannel.onFrame(prob);
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
    // コアレッシング: 発話開始を coordinator へ(未コミットの投機生成を静かにキャンセル＋発話中フラグ)。
    // STT 中の再開もここで拾えるので、onProvisionalEnd 時点で「まだ喋っている」と判定できる。
    this.coalesce?.onSpeechStart();
    if (this.recording) return;
    this.recording = true;
    this.recorded = [...this.ring]; // 先読みパディング込みで開始
    if (this.vadDebug) {
      this.dbgFrames = 0;
      this.dbgZeroFrames = 0;
      this.dbgMaxGapMs = 0;
      this.dbgGapStalls = 0;
      this.lastFrameAt = 0;
    }
    this.sendState('recording');
  }

  private onSpeechEnd(): void {
    if (this.recording) this.endTurn();
  }

  /** 録音を確定し、非同期で文字起こし→テキストを renderer へ(フレーム処理はブロックしない)。 */
  private endTurn(): void {
    if (!this.recording) return;
    this.recording = false;
    // コアレッシング: 無音で区切れた=ユーザは(今は)黙った。STT の前にフラグを下ろす
    // (STT 中に再開すれば onSpeechStart が再び立てる)。
    this.coalesce?.onSpeechEnd();
    if (this.vadDebug) {
      // 分断原因の切り分け: zeroRms が多い/maxArrivalGap が大きいなら取り込み(ScriptProcessor)が犯人。
      log.info(
        `vad capture: frames=${this.dbgFrames} zeroRms=${this.dbgZeroFrames} ` +
          `maxArrivalGap=${Math.round(this.dbgMaxGapMs)}ms stalls(>64ms)=${this.dbgGapStalls}`,
      );
    }
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
        const silenceMs = this.coalesce?.minSilenceMs ?? VAD_MIN_SILENCE_MS;
        log.info(
          `vad transcript (${text.length} chars, stt=${Math.round(performance.now() - t)}ms; ` +
            `+silence ${silenceMs}ms before)`,
        );
        // コアレッシング: 確定でなく**暫定**ターン終了として coordinator へ(投機生成＋連結)。
        // 既定(非コアレッシング)は従来どおり renderer へ送り、renderer が sendMessage に流す。
        if (this.coalesce) this.coalesce.onProvisionalEnd(text);
        else this.send('ene:voice-transcript', text);
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

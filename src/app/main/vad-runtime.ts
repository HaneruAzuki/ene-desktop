import type { BrowserWindow } from 'electron';
import { performance } from 'node:perf_hooks';
import { log } from '../../shared/logger';
import { SileroVad } from '../../voice/silero-vad';
import { VadSegmenter, DEFAULT_VAD_CONFIG } from '../../voice/vad-segmenter';
import { transcribe, isSttModelAvailable } from '../../voice/stt-transcriber';
import { turnNodStrength } from '../../voice/turn-nod';
import type { BackchannelController } from './backchannel-controller';
import {
  VAD_FRAME_SIZE,
  VAD_FRAME_QUEUE_MAX,
  VAD_SPEECH_PAD_MS,
  VAD_MIN_SILENCE_MS,
  STT_SAMPLE_RATE,
  COALESCE_WINDOW_MAX_MS,
} from '../../shared/constants';
import { IPC } from '../../shared/ipc-channels';

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
  /** トリミ発話中の barge-in のタイミング分類(案①・窓の伸縮)。isEarly=無音開始〜MAX窓以内の被せ。 */
  onBargeInTiming: (isEarly: boolean) => void;
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
  private draining = false; // drain ループ進行中(逐次処理の単一実行を保証)
  private queue: Float32Array[] = []; // 取り込み待ちフレーム(バウンド付き・バースト吸収)
  private droppedFrames = 0; // 過負荷で捨てたフレーム数(累積・観測用)
  private lastDropLogAt = 0;
  private recording = false;
  private speaking = false; // 実再生中(エコーガード=strict VAD 用・renderer 由来で明滅しうる)
  private responseActive = false; // 応答ターンが進行中(barge-in 判定の唯一の真実・main 由来で安定=明滅しない)
  private lastSpeechEndAt = 0; // 直近の speech-end の時刻(案①: barge-in の早い/遅い分類=無音開始からの経過)
  private recorded: Float32Array[] = [];
  private ring: Float32Array[] = []; // 直近フレーム(先読みパディング用)

  // 相槌(task_18 Phase B・任意)。ユーザ発話中の言いよどみで相槌を打つ。
  // listenOnly: 相槌テスト用(env ENE_LISTEN_ONLY=1)。ターン終了時に文字起こし・応答(Claude/記憶)を
  //   スキップし、VAD＋相槌だけを動かす。レイテンシ問題と無関係に相槌の体感を検証できる。
  constructor(
    private readonly win: BrowserWindow,
    private readonly backchannel?: BackchannelController,
    private readonly listenOnly = false,
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
    this.queue = [];
    this.droppedFrames = 0;
    this.speaking = false;
    this.responseActive = false;
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
    this.responseActive = false;
    this.recorded = [];
    this.ring = [];
    this.queue = [];
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

  /**
   * 応答ターンが進行中か(barge-in 判定の唯一の真実)。main の「第一声(コミット)」で true、
   * 「barge-in/次ターン開始」で false。再生の明滅(speaking)から分離=安定して被せ割り込みを拾える。
   */
  setResponseActive(active: boolean): void {
    this.responseActive = active;
  }

  /** 暫定ターン終了の無音窓(ms)を更新する(コアレッシングの適応・段階②・coordinator から呼ぶ)。 */
  setSilenceWindow(ms: number): void {
    this.seg.setMinSilenceMs(ms);
  }

  /**
   * 1フレームを取り込む。Silero は RNN 状態を持つため**逐次**処理する必要がある。
   * 推論が一時的にフレーム間隔(約32ms)を超えても、バウンド付きキューでバーストを吸収して
   * 取りこぼさない(以前は busy 中のフレームを無言ドロップ=発話頭の欠落に気づけなかった)。
   * 持続的に追いつかない場合のみ最古を捨ててバックログを有界に保ち、件数を計測ログに残す。
   */
  async pushFrame(frame: Float32Array): Promise<void> {
    if (!this.active) return;
    if (this.queue.length >= VAD_FRAME_QUEUE_MAX) {
      this.queue.shift(); // 過負荷: 最古を捨てて有界に保つ(無限遅延を防ぐ)
      this.droppedFrames++;
      const now = performance.now();
      if (now - this.lastDropLogAt > 5000) {
        log.warn(`VAD overloaded: dropped ${this.droppedFrames} frames so far (inference slower than realtime)`);
        this.lastDropLogAt = now;
      }
    }
    this.queue.push(frame);
    if (this.draining) return; // 既に drain 中=この frame はキューから順に処理される
    this.draining = true;
    try {
      while (this.active) {
        const next = this.queue.shift();
        if (!next) break;
        await this.processFrame(next);
      }
    } finally {
      this.draining = false;
    }
  }

  /** キューから取り出した1フレームを処理する(VAD 推論→セグメンタ→イベント)。 */
  private async processFrame(frame: Float32Array): Promise<void> {
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
      // タイミング判定のみ(韻律トーン判定 Lv2 は撤去・2026-06-10)。
      if (!this.speaking && this.backchannel) {
        this.backchannel.onFrame(prob);
      }
      const ev = this.seg.push(prob);
      if (ev === 'speech-start') this.onSpeechStart();
      else if (ev === 'speech-end') this.onSpeechEnd();
    } catch (e) {
      log.warn(`VAD frame failed: ${(e as Error).name}`);
    }
  }

  private onSpeechStart(): void {
    if (this.responseActive) {
      // 応答ターンの進行中に発話開始 = 割り込み(明滅しない responseActive で確実に拾う)。
      this.send(IPC.VOICE_BARGE_IN);
      // 案①: barge-in の早い/遅いを分類して窓を伸縮(早い=無音開始=直近 speech-end から MAX窓以内)。
      if (this.coalesce && this.lastSpeechEndAt) {
        const sinceSilence = performance.now() - this.lastSpeechEndAt;
        this.coalesce.onBargeInTiming(sinceSilence <= COALESCE_WINDOW_MAX_MS);
      }
    }
    // コアレッシング: 発話開始を coordinator へ(未コミットの投機生成を静かにキャンセル＋発話中フラグ)。
    // STT 中の再開もここで拾えるので、onProvisionalEnd 時点で「まだ喋っている」と判定できる。
    this.coalesce?.onSpeechStart();
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
    // コアレッシング: 無音で区切れた=ユーザは(今は)黙った。STT の前にフラグを下ろす
    // (STT 中に再開すれば onSpeechStart が再び立てる)。直近 speech-end の時刻も記録(案①: barge-in 分類)。
    this.lastSpeechEndAt = performance.now();
    this.coalesce?.onSpeechEnd();
    // ターン終端うなずき(2026-06-12): 無音窓が閉じた=「無音枠終端」で1回うなずき、ターン受け取りを視覚で示す。
    //   深さは直前の発話の長さ(録音フレーム数→ms)で出し分ける(短い=軽く / 長い=重め)。STT を待たない=窓終端ぴったり。
    //   §6.2: ms と深さ(数値)のみログ・本文は出さない。listenOnly でも窓終端の視覚信号として出す。
    const speechMs = (this.recorded.length * VAD_FRAME_SIZE * 1000) / STT_SAMPLE_RATE;
    const nodStrength = turnNodStrength(speechMs);
    log.info(`turn nod (speech=${Math.round(speechMs)}ms strength=${nodStrength})`);
    this.send(IPC.TURN_NOD, nodStrength);
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
      const text = await transcribe(audio);
      if (text && this.active) {
        // §6.2: 本文は出さない(文字数と ms のみ)。
        const silenceMs = this.coalesce?.minSilenceMs ?? VAD_MIN_SILENCE_MS;
        log.info(
          `vad transcript (${text.length} chars, stt=${Math.round(performance.now() - t)}ms; ` +
            `+silence ${silenceMs}ms before)`,
        );
        // 確定したユーザー発話を renderer へ(コアレッシング有無に関わらず)。renderer はこれを
        // アイドル計時のリセット(話しかけられた=前を向く)に使う。生成経路には影響しない。
        this.send(IPC.USER_SAID, text);
        // コアレッシング: 確定でなく**暫定**ターン終了として coordinator へ(投機生成＋連結)。
        // 既定(非コアレッシング)は従来どおり renderer へ送り、renderer が sendMessage に流す。
        if (this.coalesce) this.coalesce.onProvisionalEnd(text);
        else this.send(IPC.VOICE_TRANSCRIPT, text);
      } else {
        this.sendState('listening'); // 空認識 → 聞き取りに戻る
      }
    } catch (e) {
      log.warn(`vad transcribe failed: ${(e as Error).name}`);
      this.sendState('listening');
    }
  }

  private sendState(state: 'listening' | 'recording' | 'transcribing'): void {
    this.send(IPC.VOICE_STATE, state);
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

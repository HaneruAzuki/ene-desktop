import { buildEqChain } from './voice-eq';
import { decodeWav, stopSourceSafely } from './audio-graph';

// 音声チャンク(WAV)の逐次再生(task_17 Phase A / design-revision-voice §1)。
// main から届く WAV を AudioContext で順番に再生する。
// barge-in(task_17 Phase C)では stopPlayback() で再生を即停止する。
// 「ENE が実際に喋っている区間」を main に伝えるため、再生開始/終了を通知する
// (barge-in 検出の有効期間=発話中フラグに使う。長さ推定タイマーだと実音声とズレるため)。

/** 再生キューの1要素=1文の音声＋(あれば)その文の表示テキストと通し番号。 */
interface QueueItem {
  buf: AudioBuffer;
  text?: string;
  index?: number;
}

let ctx: AudioContext | null = null;
const queue: QueueItem[] = [];
// 「ENE が実際に喋っている」唯一の真実(SSOT)。main の VAD speaking フラグや相槌ダッキングは
// この playing(onPlayStart/onPlayEnd 経由)に従属する。文間ギャップで明滅させないため下の猶予で平滑化する。
let playing = false;
let currentSource: AudioBufferSourceNode | null = null;
// 文間ギャップで「再生終了」を即断しないための猶予タイマー(発話中フラグの明滅防止)。
let endGraceTimer: ReturnType<typeof setTimeout> | null = null;
let onPlayStart: (() => void) | null = null;
let onPlayEnd: (() => void) | null = null;
// 文の再生が始まった瞬間の通知(Phase A: 再生同期で吹き出しを1文ずつ伸ばす/「聞かせた文」の確定)。
let onSentenceStart: ((text: string, index: number) => void) | null = null;

/** 再生の開始/終了の通知先を登録する(task_17 Phase C・barge-in の発話中判定)。 */
export function setPlaybackHandlers(start: () => void, end: () => void): void {
  onPlayStart = start;
  onPlayEnd = end;
}

/** 文の再生開始の通知先を登録する(Phase A・再生同期の吹き出し)。 */
export function setSentenceHandler(cb: (text: string, index: number) => void): void {
  onSentenceStart = cb;
}

// リップシンク用の振幅解析(F・B-05)。再生グラフに AnalyserNode を1つ挟み、
// VRM レンダラが毎フレーム getVoiceAmplitude() で開口量を取得する(母音判定は不要・開口量だけで十分自然)。
let analyser: AnalyserNode | null = null;
// 声色補正 EQ がある場合に source が接続する入口ノード(EQ チェーンの先頭)。無ければ analyser。
let graphInput: AudioNode | null = null;
// 出力音量/ミュート(UI改修 段階3)。analyser の後段に GainNode を挟んで実効音量を制御する。
let gain: GainNode | null = null;
let outputVolume = 1; // 0〜1
let outputMuted = false;
// 注: 型注釈を付けず推論に任せる(Float32Array<ArrayBuffer> となり getFloatTimeDomainData に渡せる)。
let ampData = new Float32Array(0);
/** RMS(発話で概ね 0〜0.3)を開口量へ写すゲイン。大きすぎると常時フルオープン(口ガバガバ)になる。 */
const VOICE_AMP_GAIN = 3;

/**
 * 文の再生が終わってキューが一時的に空になっても、この時間だけ「再生終了」を遅らせる(文間ギャップ吸収)。
 * 猶予内に次チャンクが届けば終了をキャンセルして継続する=発話中フラグ(playing→VAD speaking)が文間で
 * false→true に明滅して barge-in を取りこぼす/自声に相槌を打つのを防ぐ。実機の文間ギャップ実測に合わせ調整。
 */
const PLAYBACK_END_GRACE_MS = 220;

function getCtx(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** 再生グラフの AnalyserNode(初回に生成し destination へ接続)。各 source はここへ繋ぐ。 */
function getAnalyser(): AnalyserNode {
  const c = getCtx();
  if (!analyser) {
    analyser = c.createAnalyser();
    analyser.fftSize = 256; // 時間波形 RMS には十分小さく・軽量
    // 出力音量/ミュートは analyser の後段の GainNode で制御(analyser は gain の前=
    // 音量に依存しない。ミュート中でもリップシンクの開口量は動く)。
    gain = c.createGain();
    gain.gain.value = outputMuted ? 0 : outputVolume;
    analyser.connect(gain);
    gain.connect(c.destination);
    // 声色補正 EQ(voice.json 由来・任意)を analyser の前段に挟む。
    // source → [EQ...] → analyser → gain → destination。F0 は変えず音色だけ整える(劣化なし)。
    const eq = buildEqChain(c);
    if (eq) {
      eq.output.connect(analyser);
      graphInput = eq.input;
    } else {
      graphInput = analyser;
    }
  }
  return analyser;
}

/** source が接続すべき入口ノード(EQ があればその先頭・なければ analyser)。グラフ構築を保証する。 */
function getGraphInput(): AudioNode {
  const a = getAnalyser();
  return graphInput ?? a;
}

/** トリミの声(出力)の音量を設定する 0〜1(UI改修 段階3)。ミュート中は値だけ保持。 */
export function setOutputVolume(v: number): void {
  outputVolume = Math.max(0, Math.min(1, v));
  if (gain && !outputMuted) gain.gain.value = outputVolume;
}
/** ミュートの切替(UI改修 段階3)。解除時は保持した音量へ戻す。 */
export function setMuted(m: boolean): void {
  outputMuted = m;
  if (gain) gain.gain.value = m ? 0 : outputVolume;
}
/** 現在ミュート中か(相槌など別系統がミュートを尊重するため)。 */
export function isMuted(): boolean {
  return outputMuted;
}

/** いま実際に音声を再生中か(テキスト送信が「割り込み」かどうかの判定に使う・#8 単一中断機構)。 */
export function isPlaying(): boolean {
  return playing;
}

/**
 * いま再生中の音声の開口量(0〜1)。非再生時は 0。
 * VRM のリップシンク(口形 aa の weight)を駆動する純データ取得(F・設計 §11.1 振幅ドリブン)。
 */
export function getVoiceAmplitude(): number {
  if (!playing || !analyser) return 0;
  const n = analyser.fftSize;
  if (ampData.length !== n) ampData = new Float32Array(n);
  analyser.getFloatTimeDomainData(ampData);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ampData[i] * ampData[i];
  const rms = Math.sqrt(sum / n);
  return Math.min(1, rms * VOICE_AMP_GAIN);
}

function playNext(): void {
  const item = queue.shift();
  if (!item) {
    // キューが一時的に空。ストリーミングの文間ギャップかもしれないので即「終了」とせず猶予を置く。
    // 猶予内に次チャンクが届けば継続(enqueueAudio が timer を解除して再開)、届かなければ終了。
    if (playing && !endGraceTimer) {
      endGraceTimer = setTimeout(() => {
        endGraceTimer = null;
        if (queue.length > 0) {
          playNext(); // 猶予中に届いていた=継続(onPlayStart は再発火しない=発話中フラグを保つ)
          return;
        }
        playing = false;
        currentSource = null;
        onPlayEnd?.();
      }, PLAYBACK_END_GRACE_MS);
    }
    return;
  }
  const src = getCtx().createBufferSource();
  src.buffer = item.buf;
  // destination へは EQ(あれば)→ analyser 経由(リップシンクの振幅取得＋声色補正のため)。
  src.connect(getGraphInput());
  src.onended = (): void => {
    if (currentSource === src) currentSource = null;
    playNext();
  };
  currentSource = src;
  src.start();
  // この文の再生が始まった=ユーザに「聞かせた」瞬間。テキストがあれば吹き出しへ(再生同期・Phase A)。
  if (item.text !== undefined) onSentenceStart?.(item.text, item.index ?? 0);
}

/** WAV を1つ受け取り、デコードして再生キューに積む(順番に再生される)。text/index はストリーミングのみ。 */
export async function enqueueAudio(wav: ArrayBuffer, text?: string, index?: number): Promise<void> {
  const c = getCtx();
  // 自動再生ポリシー対策: 送信(クリック/Enter)後に届くのでユーザー操作済み。decodeWav が resume も行う。
  const buf = await decodeWav(c, wav);
  queue.push({ buf, text, index });
  if (endGraceTimer) {
    // 文間ギャップの猶予中に次チャンク到着=継続。終了をキャンセルし、onPlayStart は再発火しない。
    clearTimeout(endGraceTimer);
    endGraceTimer = null;
    if (!currentSource) playNext();
    return;
  }
  if (!playing) {
    // 新しい再生セッションの開始。
    playing = true;
    onPlayStart?.();
    playNext();
  }
}

/**
 * 再生を即停止し、キューも空にする(barge-in・task_17 Phase C)。
 * ENE が喋っている最中にユーザーが話しかけたら、ENE の声をすぐ止めるために使う。
 */
export function stopPlayback(): void {
  queue.length = 0;
  if (endGraceTimer) {
    clearTimeout(endGraceTimer); // 猶予中の終了予約を破棄(onPlayEnd の二重発火を防ぐ)
    endGraceTimer = null;
  }
  if (currentSource) {
    stopSourceSafely(currentSource);
    currentSource = null;
  }
  if (playing) {
    playing = false;
    onPlayEnd?.();
  }
}

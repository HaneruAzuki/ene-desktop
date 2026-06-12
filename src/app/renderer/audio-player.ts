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
let playing = false;
let currentSource: AudioBufferSourceNode | null = null;
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
// 注: 型注釈を付けず推論に任せる(Float32Array<ArrayBuffer> となり getFloatTimeDomainData に渡せる)。
let ampData = new Float32Array(0);
/** RMS(発話で概ね 0〜0.3)を開口量へ写すゲイン。大きすぎると常時フルオープン(口ガバガバ)になる。 */
const VOICE_AMP_GAIN = 3;

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
    analyser.connect(c.destination);
  }
  return analyser;
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
    // キューが尽きた=再生終了。
    if (playing) {
      playing = false;
      currentSource = null;
      onPlayEnd?.();
    }
    return;
  }
  const src = getCtx().createBufferSource();
  src.buffer = item.buf;
  src.connect(getAnalyser()); // destination へは analyser 経由(リップシンクの振幅取得のため)
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
  // 自動再生ポリシー対策: 送信(クリック/Enter)後に届くのでユーザー操作済み。念のため resume。
  if (c.state === 'suspended') await c.resume();
  // decodeAudioData は渡した ArrayBuffer を detach するため、コピーを渡す。
  const buf = await c.decodeAudioData(wav.slice(0));
  queue.push({ buf, text, index });
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
  if (currentSource) {
    currentSource.onended = null; // playNext を呼ばせない
    try {
      currentSource.stop();
    } catch {
      /* 既に停止済みなら無視 */
    }
    currentSource = null;
  }
  if (playing) {
    playing = false;
    onPlayEnd?.();
  }
}

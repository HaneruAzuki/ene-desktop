// 音声チャンク(WAV)の逐次再生(task_17 Phase A / design-revision-voice §1)。
// main から届く WAV を AudioContext で順番に再生する。
// barge-in(task_17 Phase C)では stopPlayback() で再生を即停止する。
// 「ENE が実際に喋っている区間」を main に伝えるため、再生開始/終了を通知する
// (barge-in 検出の有効期間=発話中フラグに使う。長さ推定タイマーだと実音声とズレるため)。

let ctx: AudioContext | null = null;
const queue: AudioBuffer[] = [];
let playing = false;
let currentSource: AudioBufferSourceNode | null = null;
let onPlayStart: (() => void) | null = null;
let onPlayEnd: (() => void) | null = null;

/** 再生の開始/終了の通知先を登録する(task_17 Phase C・barge-in の発話中判定)。 */
export function setPlaybackHandlers(start: () => void, end: () => void): void {
  onPlayStart = start;
  onPlayEnd = end;
}

function getCtx(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

function playNext(): void {
  const buf = queue.shift();
  if (!buf) {
    // キューが尽きた=再生終了。
    if (playing) {
      playing = false;
      currentSource = null;
      onPlayEnd?.();
    }
    return;
  }
  const src = getCtx().createBufferSource();
  src.buffer = buf;
  src.connect(getCtx().destination);
  src.onended = (): void => {
    if (currentSource === src) currentSource = null;
    playNext();
  };
  currentSource = src;
  src.start();
}

/** WAV を1つ受け取り、デコードして再生キューに積む(順番に再生される)。 */
export async function enqueueAudio(wav: ArrayBuffer): Promise<void> {
  const c = getCtx();
  // 自動再生ポリシー対策: 送信(クリック/Enter)後に届くのでユーザー操作済み。念のため resume。
  if (c.state === 'suspended') await c.resume();
  // decodeAudioData は渡した ArrayBuffer を detach するため、コピーを渡す。
  const buf = await c.decodeAudioData(wav.slice(0));
  queue.push(buf);
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

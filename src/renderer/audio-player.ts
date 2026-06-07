// 音声チャンク(WAV)の逐次再生(task_17 Phase A / design-revision-voice §1)。
// main から届く WAV を AudioContext で順番に再生する。renderer は再生のみ(マイクは Phase B)。

let ctx: AudioContext | null = null;
const queue: AudioBuffer[] = [];
let playing = false;

function getCtx(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

function playNext(): void {
  const buf = queue.shift();
  if (!buf) {
    playing = false;
    return;
  }
  playing = true;
  const src = getCtx().createBufferSource();
  src.buffer = buf;
  src.connect(getCtx().destination);
  src.onended = (): void => playNext();
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
  if (!playing) playNext();
}

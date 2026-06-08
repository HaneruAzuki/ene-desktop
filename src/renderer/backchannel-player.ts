// 相槌の即時再生(task_18 Phase B・聞くターン)。
// 応答音声の再生キュー(audio-player)とは別系統の「単発再生」。相槌はユーザ発話中に
// 割り込みで鳴らすため、キューに積まず即座に鳴らす(順序保証も不要)。
//
// ⚠️ エコー: 相槌はユーザ発話中に鳴るためマイクへ回り込みうる。getUserMedia の
// echoCancellation で抑制する前提(実機で要検証=task_18 Phase D / N-17-9 と同根)。

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** 相槌 WAV を1つ、即座に再生する(キューに積まない)。 */
export async function playBackchannel(wav: ArrayBuffer): Promise<void> {
  const c = getCtx();
  if (c.state === 'suspended') await c.resume();
  // decodeAudioData は渡した ArrayBuffer を detach するためコピーを渡す。
  const buf = await c.decodeAudioData(wav.slice(0));
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start();
}

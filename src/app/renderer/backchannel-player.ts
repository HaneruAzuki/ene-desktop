// 相槌の即時再生(task_18 Phase B・聞くターン)。
// 応答音声の再生キュー(audio-player)とは別系統の「単発再生」。相槌はユーザ発話中に
// 割り込みで鳴らすため、キューに積まず即座に鳴らす(順序保証も不要)。
//
// ⚠️ エコー: 相槌はユーザ発話中に鳴るためマイクへ回り込みうる。getUserMedia の
// echoCancellation で抑制する前提(実機で要検証=task_18 Phase D / N-17-9 と同根)。
//
// ダッキング(barge-in / 応答開始): 相槌「うん」が鳴り残ったまま ENE が応答を喋り始める/
// ユーザが割り込むと声が重なる。stopBackchannel() で再生中の相槌を即停止し、重なりを防ぐ。

import { isMuted } from './audio-player';

let ctx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getCtx(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** 相槌 WAV を1つ、即座に再生する(キューに積まない)。 */
export async function playBackchannel(wav: ArrayBuffer): Promise<void> {
  if (isMuted()) return; // ミュート中はトリミの声(相槌含む)を鳴らさない(UI改修 段階3)
  const c = getCtx();
  if (c.state === 'suspended') await c.resume();
  // decodeAudioData は渡した ArrayBuffer を detach するためコピーを渡す。
  const buf = await c.decodeAudioData(wav.slice(0));
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  // 自然終了で currentSource を解放(stopBackchannel の対象から外す)。
  src.onended = (): void => {
    if (currentSource === src) currentSource = null;
  };
  currentSource = src;
  src.start();
}

/**
 * 再生中の相槌を即停止する(ダッキング・barge-in / 応答開始時)。
 * ENE が応答を喋り始める/ユーザが割り込んだ瞬間に、鳴り残った相槌「うん」を黙らせ、
 * ENE の声と相槌が重なるのを防ぐ。再生中でなければ何もしない(no-op)。
 */
export function stopBackchannel(): void {
  if (currentSource) {
    currentSource.onended = null; // 解放ロジックを呼ばせない
    try {
      currentSource.stop();
    } catch {
      /* 既に停止済みなら無視 */
    }
    currentSource = null;
  }
}

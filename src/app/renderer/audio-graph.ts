// renderer の音声再生ヘルパ(応答再生 audio-player と相槌 backchannel-player で共有する小片)。
// 両プレイヤーはキュー再生 vs 単発再生でライフサイクルが異なるが、以下2つは完全に同一だったため集約。

/** WAV(ArrayBuffer)を AudioBuffer へデコードする。suspended なら resume し、detach 回避のためコピーを渡す。 */
export async function decodeWav(ctx: AudioContext, wav: ArrayBuffer): Promise<AudioBuffer> {
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx.decodeAudioData(wav.slice(0));
}

/** 再生中の source を安全に止める(onended を外して二重解放を防ぎ、停止済みでも例外にしない)。 */
export function stopSourceSafely(src: AudioBufferSourceNode): void {
  src.onended = null;
  try {
    src.stop();
  } catch {
    /* 既に停止済みなら無視 */
  }
}

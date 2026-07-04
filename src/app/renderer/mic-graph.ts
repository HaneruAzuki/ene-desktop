import { STT_SAMPLE_RATE } from '../../shared/constants';

// 16kHz mono マイク取り込みグラフの構築＋後始末。PTT(mic-capture)とハンズフリー(voice-conversation)で
// 「getUserMedia → AudioContext(16kHz) → ScriptProcessor → gain=0 で無音化して destination」の定型と
// teardown が完全に同一だったため集約(公開前整理)。差分はバッファ長・AGC・フレーム処理だけ=呼出側が渡す。
//
// ScriptProcessorNode は deprecated だが Electron(Chromium)で安定動作し、AudioWorklet 用の別バンドル
// (§4.3 軽量・依存を増やさない方針)を避けられる。録音音声は外部に出さずローカル STT にのみ使う(§4.2/§7.1)。

export interface MicGraph {
  /** グラフを破棄し、マイク/AudioContext を解放する。 */
  teardown(): void;
}

export interface MicGraphOptions {
  /** ScriptProcessorNode のバッファ長(このサンプル数ごとに onFrame が発火)。 */
  bufferSize: number;
  /** AGC(自動ゲイン)を有効にするか。 */
  autoGainControl: boolean;
  /** 1フレーム(16kHz mono Float32・コピー済み)ごとに呼ぶ。 */
  onFrame: (frame: Float32Array) => void;
}

/**
 * 16kHz mono のマイク取り込みグラフを開始する。マイク不可時は getUserMedia が reject(呼出側で処理)。
 * echoCancellation/noiseSuppression は常に有効(barge-in で TTS がマイクへ回り込むのを抑える)。
 */
export async function createMicGraph(opts: MicGraphOptions): Promise<MicGraph> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: opts.autoGainControl,
    },
  });
  const ctx = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(opts.bufferSize, 1, 1);
  // onaudioprocess を発火させるにはグラフを destination まで繋ぐ必要があるが、そのまま繋ぐと
  // マイク音がスピーカーへ回り込む(ハウリング)。gain=0 のノードで無音化する。
  const mute = ctx.createGain();
  mute.gain.value = 0;
  processor.onaudioprocess = (e: AudioProcessingEvent): void => {
    // 内部バッファは使い回されるためコピーして渡す。
    opts.onFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  return {
    teardown(): void {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

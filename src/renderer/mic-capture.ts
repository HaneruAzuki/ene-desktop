import { STT_SAMPLE_RATE } from '../shared/constants';

// マイク取得(push-to-talk・task_17 Phase B)。
//
// AudioContext を 16kHz で作り、getUserMedia ソースをそのレートで取り込むことで
// Whisper が要求する「16kHz mono Float32」を直接得る(手動リサンプル不要)。
// ScriptProcessorNode は deprecated だが Electron(Chromium)で安定動作し、
// AudioWorklet 用の別ファイル/バンドル(§4.3 軽量・依存を増やさない方針)を避けられる。
//
// 録音音声は外部に出さない。文字起こし(ローカル・main)にのみ使う(§4.2 / §7.1)。

/** ScriptProcessorNode のバッファ長(16kHz で約0.25秒ごとに発火)。 */
const PROCESSOR_BUFFER_SIZE = 4096;

export interface Recorder {
  /** 録音を止め、収録した 16kHz mono Float32 を連結して返す。 */
  stop(): Promise<Float32Array>;
  /** 録音を破棄する(送信しない)。 */
  cancel(): void;
}

/**
 * push-to-talk の録音を開始する。呼び出し側は stop() で音声を取り出す。
 * マイクが使えない場合は getUserMedia が reject する(呼び出し側でハンドリング)。
 */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
  // onaudioprocess を発火させるにはグラフを destination まで繋ぐ必要があるが、
  // そのまま繋ぐとマイク音がスピーカーへ回り込む(ハウリング)。gain=0 のノードで無音化する。
  const mute = ctx.createGain();
  mute.gain.value = 0;

  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (e: AudioProcessingEvent): void => {
    // 内部バッファは使い回されるためコピーして保持する。
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  const cleanup = (): void => {
    processor.onaudioprocess = null;
    processor.disconnect();
    source.disconnect();
    mute.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  return {
    async stop(): Promise<Float32Array> {
      cleanup();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    },
    cancel(): void {
      cleanup();
      chunks.length = 0;
    },
  };
}

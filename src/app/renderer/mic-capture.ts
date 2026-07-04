import { createMicGraph } from './mic-graph';

// マイク取得(push-to-talk・task_17 Phase B)。
// 16kHz mono の取り込みグラフは mic-graph に集約。ここはフレームを貯めて stop() で連結する PTT の差分だけ。
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
  const chunks: Float32Array[] = [];
  // PTT は韻律を使わないので AGC は既定(on)でよい。
  const graph = await createMicGraph({
    bufferSize: PROCESSOR_BUFFER_SIZE,
    autoGainControl: true,
    onFrame: (frame) => chunks.push(frame),
  });

  return {
    async stop(): Promise<Float32Array> {
      graph.teardown();
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
      graph.teardown();
      chunks.length = 0;
    },
  };
}

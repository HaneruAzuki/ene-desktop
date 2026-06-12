import { log } from '../shared/logger';
import { getVadModelPath } from '../shared/node/paths';
import { VAD_FRAME_SIZE } from '../shared/constants';

// Silero VAD v4 ランナー(onnxruntime-node・main・task_17 Phase C)。
//
// v4 を使う理由(重要・N-17-9): v5(入力 input/state/sr)は onnxruntime-node が
// If/動的形状を誤計算し、実音声でも発話確率が ≈0 になる(無言の誤計算)。
// v4(入力 input/sr/h/c=RNN状態を h/c に分離)は onnxruntime-node で正しく動く。
//
// 入力: input[1,512] float32 / sr int64 / h,c [2,1,64] float32
// 出力: output[1,1](発話確率) / hn / cn(次状態)
//
// transformers.js には VAD パイプラインが無いため onnxruntime-node を直接使う
// (既に @huggingface/transformers の依存として同梱・externalize 済。新規 npm なし)。

type OrtModule = typeof import('onnxruntime-node');
type OrtSession = import('onnxruntime-node').InferenceSession;

let ortPromise: Promise<OrtModule> | null = null;
async function getOrt(): Promise<OrtModule> {
  // 遅延 import(VAD 未使用時にロードしない・起動を重くしない)。
  if (!ortPromise) ortPromise = import('onnxruntime-node');
  return ortPromise;
}

const STATE_LEN = 2 * 1 * 64;

/** Silero VAD v4 の薄いラッパ。フレーム逐次投入で RNN 状態(h/c)を保持する。 */
export class SileroVad {
  private session: OrtSession | null = null;
  private ort: OrtModule | null = null;
  private h = new Float32Array(STATE_LEN);
  private c = new Float32Array(STATE_LEN);

  async load(): Promise<void> {
    if (this.session) return;
    this.ort = await getOrt();
    this.session = await this.ort.InferenceSession.create(getVadModelPath());
    log.info('VAD model loaded (silero v4)');
  }

  /** 発話の区切りごとに RNN 状態を初期化する。 */
  reset(): void {
    this.h = new Float32Array(STATE_LEN);
    this.c = new Float32Array(STATE_LEN);
  }

  /** 16kHz・512サンプルの1フレームの発話確率(0..1)を返す。 */
  async process(frame: Float32Array): Promise<number> {
    if (!this.session || !this.ort) throw new Error('VAD not loaded');
    const ort = this.ort;
    const samples = frame.length === VAD_FRAME_SIZE ? frame : frame.slice(0, VAD_FRAME_SIZE);
    const out = await this.session.run({
      input: new ort.Tensor('float32', samples, [1, VAD_FRAME_SIZE]),
      sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), [1]),
      h: new ort.Tensor('float32', this.h, [2, 1, 64]),
      c: new ort.Tensor('float32', this.c, [2, 1, 64]),
    });
    this.h = Float32Array.from(out.hn.data as Float32Array);
    this.c = Float32Array.from(out.cn.data as Float32Array);
    return (out.output.data as Float32Array)[0];
  }
}

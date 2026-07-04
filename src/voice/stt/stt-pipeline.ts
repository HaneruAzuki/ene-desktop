import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { STT_LANGUAGE, STT_SAMPLE_RATE } from '../../shared/constants';

// STT パイプラインの**純粋コア**(Electron 非依存・N-REL-5)。
// in-process(stt-transcriber.ts・main)とワーカー(stt-worker.ts・utilityProcess)の両方から使う。
// モデルの置き場(modelsDir)は呼び出し側が渡す: main は getModelsDir()(app 依存)、
// ワーカーは main から受け取った絶対パスを渡す(utilityProcess に Electron app は無い)。
// 重要(§7.1): 実行時に外部へ取りに行かない(env.allowRemoteModels=false・localModelPath=modelsDir)。

// 最小限の呼び出しシグネチャ(lib のオーバーロード型は本用途には過剰なため絞る)。
export type AsrPipeline = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text?: string }>;

type Dtype = 'fp32' | 'q8';

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * ASR パイプラインをロードする(配置済みファイルから dtype を自動判定)。
 *  - encoder: encoder_model.onnx が在れば fp32(精度優先)、無ければ q8(kotoba は巨大ゆえ q8 同梱=自動 q8)。
 *  - decoder: decoder_model_merged_quantized.onnx が在れば q8、無ければ fp32。
 * transformers.js は ESM・ネイティブ依存(onnxruntime-node)を含むため遅延 import する。
 */
export async function loadAsrPipeline(
  modelsDir: string,
  modelDir: string,
): Promise<{ asr: AsrPipeline; encoderDtype: Dtype; decoderDtype: Dtype }> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = modelsDir;
  const onnxDir = join(modelsDir, modelDir, 'onnx');
  const encoderDtype: Dtype = (await fileExists(join(onnxDir, 'encoder_model.onnx'))) ? 'fp32' : 'q8';
  const decoderDtype: Dtype = (await fileExists(join(onnxDir, 'decoder_model_merged_quantized.onnx')))
    ? 'q8'
    : 'fp32';
  const dtype: Record<string, Dtype> = { encoder_model: encoderDtype, decoder_model_merged: decoderDtype };
  const asr = await pipeline('automatic-speech-recognition', modelDir, { dtype });
  return { asr: asr as unknown as AsrPipeline, encoderDtype, decoderDtype };
}

/** 16kHz mono Float32 を文字起こし(日本語固定)。空入力は空文字。言語固定で短文の言語判定ブレを防ぐ。 */
export async function runTranscribe(asr: AsrPipeline, samples: Float32Array): Promise<string> {
  if (samples.length === 0) return '';
  const out = await asr(samples, {
    language: STT_LANGUAGE,
    task: 'transcribe',
    chunk_length_s: 30, // 長い発話も分割(短い発話は実質1チャンク)
    no_repeat_ngram_size: 3, // 長音・同語の暴走を抑える
    return_timestamps: false,
  });
  return (out.text ?? '').trim();
}

/** 0.5 秒の無音で1回推論し、ONNX セッションの初回実行コストを前倒しする(出力は捨てる)。 */
export async function runWarm(asr: AsrPipeline): Promise<void> {
  const silence = new Float32Array(Math.floor(STT_SAMPLE_RATE / 2));
  await asr(silence, { language: STT_LANGUAGE, task: 'transcribe', chunk_length_s: 30, return_timestamps: false });
}

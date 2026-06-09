import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { log } from '../shared/logger';
import { getModelsDir } from '../storage/paths';
import { STT_MODEL_DIR, STT_MODEL_DIR_ENV, STT_LANGUAGE } from '../shared/constants';

/** 使用する STT モデルのディレクトリ名(env 上書き可・A/B 比較用)。既定は STT_MODEL_DIR。 */
function sttModelDir(): string {
  return process.env[STT_MODEL_DIR_ENV] || STT_MODEL_DIR;
}

// ローカル音声認識(whisper-small・ONNX・task_17 Phase B / N-LAT-6)。
//
// モデル既定は whisper-small(2026-06-09 計測で turbo→small・stt ~3000ms→~800ms・精度ほぼ同等)。
// 高精度が要るときは ENE_STT_MODEL_DIR=whisper-large-v3-turbo で差し替え可(sttModelDir())。
//
// 重要(§7.1 厳守): アプリ実行時に外部へモデルを取りに行かない。embedder.ts と同方針。
//   - env.allowRemoteModels = false でローカル限定。
//   - モデルは別ダウンロード(scripts/download-stt-model.mjs)で
//     data/models/<dir> に配置(既定 whisper-small)。
//   - 未配置/ロード失敗時は例外 → 呼び出し側(ipc)がキャラ口調でフォールバック。
//
// 実行は main プロセス(onnxruntime-node・CPU)。精度最優先で encoder=fp32。
// GPU(WebGPU)は将来の速度最適化レバー(renderer 移設が必要・現状は採らない)。
// transformers.js は ESM・ネイティブ依存(onnxruntime-node)を含むため遅延 import する。

// 最小限の呼び出しシグネチャ(lib のオーバーロード型は本用途には過剰なため絞る)。
type AsrPipeline = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text?: string }>;

let pipelinePromise: Promise<AsrPipeline> | null = null;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadPipeline(): Promise<AsrPipeline> {
  const { pipeline, env } = await import('@huggingface/transformers');
  // ローカル限定(実行時に HuggingFace 等へ取りに行かない)。
  env.allowRemoteModels = false;
  env.localModelPath = getModelsDir();
  // 量子化デコーダ(q8=_quantized)があれば使う。精度はほぼ同等でサイズ/速度が有利。
  // 無ければ fp32 にフォールバック(ダウンロードスクリプトの取得状況に依存しない)。
  const modelDir = sttModelDir();
  const quantDecoder = join(getModelsDir(), modelDir, 'onnx', 'decoder_model_merged_quantized.onnx');
  const decoderDtype: 'fp32' | 'q8' = (await fileExists(quantDecoder)) ? 'q8' : 'fp32';
  const dtype: Record<string, 'fp32' | 'q8'> = {
    encoder_model: 'fp32',
    decoder_model_merged: decoderDtype,
  };
  log.info(`loading STT model from ${getModelsDir()}/${modelDir} (decoder=${decoderDtype})`);
  const asr = await pipeline('automatic-speech-recognition', modelDir, { dtype });
  return asr as unknown as AsrPipeline;
}

/**
 * モデル本体が配置済みか(config.json の存在で判定)。
 * 未配置なら呼び出し側は音声入力を無効化し、キャラ口調で「まだ準備できてない」と返す。
 */
export async function isSttModelAvailable(): Promise<boolean> {
  return fileExists(join(getModelsDir(), sttModelDir(), 'config.json'));
}

/**
 * 16kHz mono Float32 を文字起こしして返す(日本語固定)。空入力は空文字。
 * 言語を固定するのは、短い発話で言語自動判定がブレて精度が落ちるのを防ぐため。
 */
export async function transcribe(samples: Float32Array): Promise<string> {
  if (samples.length === 0) return '';
  if (!pipelinePromise) pipelinePromise = loadPipeline();
  const asr = await pipelinePromise;
  const out = await asr(samples, {
    language: STT_LANGUAGE,
    task: 'transcribe',
    chunk_length_s: 30, // 長い発話も分割処理(短い push-to-talk では実質1チャンク)
    no_repeat_ngram_size: 3, // 長音・同語の暴走を抑える
    return_timestamps: false,
  });
  return (out.text ?? '').trim();
}

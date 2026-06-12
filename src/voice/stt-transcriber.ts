import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { log } from '../shared/logger';
import { getModelsDir } from '../shared/node/paths';
import { STT_MODEL_DIR, STT_MODEL_DIR_ENV, STT_LANGUAGE, STT_SAMPLE_RATE } from '../shared/constants';

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
// 実行は main プロセス(onnxruntime-node・CPU)。dtype は配置ファイルから自動判定(下記 loadPipeline)。
// GPU(WebGPU/DirectML)は将来の速度最適化レバー(renderer 移設 or DirectML EP が必要・現状は採らない)。
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
  // dtype は配置済みファイルから**自動判定**する(モデルごとに最適な量子化を選ぶ)。
  //  - encoder: fp32(encoder_model.onnx)が在れば精度優先で fp32。無ければ q8(_quantized)。
  //    ※ kotoba-whisper 等は fp32 エンコーダが巨大(~2.5GB・外部データ)なので q8(645MB)を配置=自動で q8。
  //  - decoder: q8(decoder_model_merged_quantized.onnx)が在れば q8、無ければ fp32。
  const modelDir = sttModelDir();
  const onnxDir = join(getModelsDir(), modelDir, 'onnx');
  const encoderDtype: 'fp32' | 'q8' = (await fileExists(join(onnxDir, 'encoder_model.onnx')))
    ? 'fp32'
    : 'q8';
  const decoderDtype: 'fp32' | 'q8' = (await fileExists(
    join(onnxDir, 'decoder_model_merged_quantized.onnx'),
  ))
    ? 'q8'
    : 'fp32';
  const dtype: Record<string, 'fp32' | 'q8'> = {
    encoder_model: encoderDtype,
    decoder_model_merged: decoderDtype,
  };
  log.info(
    `loading STT model from ${getModelsDir()}/${modelDir} (encoder=${encoderDtype} decoder=${decoderDtype})`,
  );
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
 * STT モデルを起動時に**背景でロード＋小さな推論でウォーム**する(初回発話の「読込で数十秒待ち」を前倒し)。
 * kotoba(~1GB)等は初回ロード＋初回推論が重いので、起動直後に温めておくと最初の発話から速い。
 * best-effort(モデル未配置/失敗は無視・本番の transcribe で再試行される)。準備完了判定には含めない。
 */
export async function warmStt(): Promise<void> {
  try {
    if (!(await isSttModelAvailable())) return;
    if (!pipelinePromise) pipelinePromise = loadPipeline();
    const asr = await pipelinePromise;
    // 0.5秒の無音で1回だけ推論し、ONNX セッションの初回実行コストも前倒しする(出力は捨てる)。
    const silence = new Float32Array(Math.floor(STT_SAMPLE_RATE / 2));
    await asr(silence, {
      language: STT_LANGUAGE,
      task: 'transcribe',
      chunk_length_s: 30,
      return_timestamps: false,
    });
    log.info('STT model warmed');
  } catch (e) {
    log.warn(`STT warm failed: ${(e as Error).name}`);
  }
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

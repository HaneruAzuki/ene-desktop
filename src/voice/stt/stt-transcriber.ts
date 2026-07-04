import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../shared/logger';
import { getModelsDir } from '../../shared/node/paths';
import { STT_MODEL_DIR, STT_MODEL_DIR_ENV } from '../../shared/constants';
import { loadAsrPipeline, runTranscribe, runWarm, type AsrPipeline } from './stt-pipeline';

// ローカル音声認識(kotoba-whisper-v2.2・ONNX・task_17 Phase B / N-LAT-6)の **in-process 実装**。
// パイプラインの純粋コアは stt-pipeline.ts(Electron 非依存)に分離し、ここは main プロセスの都合
// (モデル置き場=getModelsDir・env 上書き・シングルトン・ウォーム)を担う。
// 重い STT を別プロセスへ逃がす経路は stt-worker(-client)(N-REL-5・既定 off=ENE_STT_WORKER=1 で有効化)。
// ここは worker 無効時/フォールバック時の実体=「必ず動く」基準実装。
//
// 重要(§7.1): 実行時に外部へモデルを取りに行かない(stt-pipeline で allowRemoteModels=false)。
//   モデルは別DL(scripts/download-stt-model.mjs)で data/models/<dir> に配置(既定 kotoba-whisper-v2.2)。

/** 使用する STT モデルのディレクトリ名(env 上書き可・A/B 比較用)。既定は STT_MODEL_DIR。 */
export function sttModelDir(): string {
  return process.env[STT_MODEL_DIR_ENV] || STT_MODEL_DIR;
}

let pipelinePromise: Promise<AsrPipeline> | null = null;

async function loadPipeline(): Promise<AsrPipeline> {
  const modelsDir = getModelsDir();
  const modelDir = sttModelDir();
  const { asr, encoderDtype, decoderDtype } = await loadAsrPipeline(modelsDir, modelDir);
  log.info(`loading STT model from ${modelsDir}/${modelDir} (encoder=${encoderDtype} decoder=${decoderDtype})`);
  return asr;
}

/**
 * パイプラインを遅延ロードして返す(シングルトン)。
 * ロード失敗時はキャッシュを null に戻し、次回呼び出しで再試行できる(一過性のロード失敗を恒久故障にしない)。
 */
async function getPipeline(): Promise<AsrPipeline> {
  if (!pipelinePromise) pipelinePromise = loadPipeline();
  try {
    return await pipelinePromise;
  } catch (e) {
    pipelinePromise = null; // 次回 transcribe/warm で再ロードを試みる
    throw e;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * モデル本体が配置済みか(config.json の存在で判定)。
 * 未配置なら呼び出し側は音声入力を無効化し、キャラ口調で「まだ準備できてない」と返す。
 */
export async function isSttModelAvailable(): Promise<boolean> {
  return fileExists(join(getModelsDir(), sttModelDir(), 'config.json'));
}

/**
 * STT モデルを起動時に背景でロード＋小さな推論でウォームする(初回発話の「読込で数十秒待ち」を前倒し)。
 * best-effort(モデル未配置/失敗は無視・本番の transcribe で再試行される)。
 */
export async function warmStt(): Promise<void> {
  try {
    if (!(await isSttModelAvailable())) return;
    await runWarm(await getPipeline());
    log.info('STT model warmed');
  } catch (e) {
    log.warn(`STT warm failed: ${(e as Error).name}`);
  }
}

/** 16kHz mono Float32 を文字起こしして返す(日本語固定)。空入力は空文字。 */
export async function transcribe(samples: Float32Array): Promise<string> {
  return runTranscribe(await getPipeline(), samples);
}

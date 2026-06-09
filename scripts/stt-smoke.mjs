// STT スモークテスト(task_17 Phase B・手動検証用)。
//
// voice-smoke が生成した「魚川トリミ自身の声」WAV を STT モデルで書き起こし、
// 正解テキストと並べて表示する。フル Electron 配線(マイク)の前に、
// 「ローカルモデル＋onnxruntime-node＋日本語精度」を一発で確認するためのもの。
// モデル比較(turbo vs small 等)の A/B にも使える(N-LAT-6 はこれで計測した)。
//
// 前提: npm run download:stt-model でモデルを data/models/<dir> に配置済み(既定 whisper-small)、
//       かつ voice-smoke-out/torimi_0{1,2,3}.wav が存在(npm run voice:smoke で生成)。
//
// 使い方:  node scripts/stt-smoke.mjs   (または npm run stt:smoke)
//   環境変数 ENE_STT_MODEL_DIR=<dir> で対象モデルを切替(A/B 比較)。既定は whisper-small。
//   例:  ENE_STT_MODEL_DIR=whisper-large-v3-turbo  node scripts/stt-smoke.mjs

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.join(root, 'data', 'models');
const outDir = path.join(root, 'voice-smoke-out');
const STT_SAMPLE_RATE = 16000;

// voice-smoke.mjs と同じ台詞(正解)。
const CASES = [
  { file: 'torimi_01.wav', truth: 'こんにちは、魚川トリミだよ。' },
  { file: 'torimi_02.wav', truth: '別にあんたのために来たわけじゃないんだからね。' },
  { file: 'torimi_03.wav', truth: '……ありがと。ちょっとだけ、嬉しいかも。' },
];

/** 最小限の WAV(PCM)パーサ。fmt/data チャンクを走査し mono Float32 + sampleRate を返す。 */
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        numChannels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataLen = size;
    }
    offset = body + size + (size % 2); // チャンクは偶数境界
  }
  if (!fmt || dataOffset < 0) throw new Error('missing fmt/data chunk');
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`unsupported WAV (format=${fmt.audioFormat}, bits=${fmt.bitsPerSample})`);
  }
  const frames = Math.floor(dataLen / 2 / fmt.numChannels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.numChannels; c++) {
      sum += buf.readInt16LE(dataOffset + (i * fmt.numChannels + c) * 2) / 32768;
    }
    mono[i] = sum / fmt.numChannels;
  }
  return { samples: mono, sampleRate: fmt.sampleRate };
}

/** 線形補間で目標レートへリサンプル(スモーク用途には十分)。 */
function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = to / from;
  const outLen = Math.round(samples.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = src - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const modelName = process.env.ENE_STT_MODEL_DIR || 'whisper-small';
  const modelDir = path.join(modelsDir, modelName);
  if (!(await exists(path.join(modelDir, 'config.json')))) {
    console.error(`✗ モデル未配置です(${modelName})。先に download:stt-model で配置してください。`);
    process.exit(1);
  }

  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = modelsDir;

  const decoderDtype = (await exists(
    path.join(modelDir, 'onnx', 'decoder_model_merged_quantized.onnx'),
  ))
    ? 'q8'
    : 'fp32';
  console.log(`model: ${modelName} (encoder=fp32, decoder=${decoderDtype})`);
  console.log('loading pipeline ...');
  const t0 = Date.now();
  const asr = await pipeline('automatic-speech-recognition', modelName, {
    dtype: { encoder_model: 'fp32', decoder_model_merged: decoderDtype },
  });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  for (const { file, truth } of CASES) {
    const wavPath = path.join(outDir, file);
    if (!(await exists(wavPath))) {
      console.log(`skip (no file): ${file}  — npm run voice:smoke で生成できます`);
      continue;
    }
    const { samples, sampleRate } = parseWav(await readFile(wavPath));
    const pcm = resample(samples, sampleRate, STT_SAMPLE_RATE);
    const dur = (pcm.length / STT_SAMPLE_RATE).toFixed(1);
    const tA = Date.now();
    const out = await asr(pcm, {
      language: 'japanese',
      task: 'transcribe',
      chunk_length_s: 30,
      no_repeat_ngram_size: 3,
      return_timestamps: false,
    });
    const sec = ((Date.now() - tA) / 1000).toFixed(1);
    console.log(`■ ${file}  (${dur}s 音声 / 認識 ${sec}s)`);
    console.log(`  正解: ${truth}`);
    console.log(`  認識: ${(out.text ?? '').trim()}\n`);
  }

  console.log('上の「正解」と「認識」を見比べて、日本語が正しく取れているか確認してください。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

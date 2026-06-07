// Silero VAD スモーク(task_17 Phase C・手動検証用)。
// resources/silero_vad.onnx(v4)を onnxruntime-node でロードし、無音と発話(torimi WAV)に対する
// 発話確率を出して、しきい値(0.5)が speech/silence を分離できているか確認する。
//
// ★ v4 を使う(v5 は onnxruntime-node で誤計算・N-17-9)。入力 input/sr/h/c → 出力 output/hn/cn。
//
// 使い方:  node scripts/vad-smoke.mjs   (前提: npm run download:vad-model 済 / voice-smoke-out にWAV)

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = path.join(root, 'resources', 'silero_vad.onnx');
const FRAME = 512;
const SR = 16000;

function parseWav(buf) {
  let o = 12, fmt = null, dOff = -1, dLen = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4), size = buf.readUInt32LE(o + 4), body = o + 8;
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(body + 2), sr: buf.readUInt32LE(body + 4) };
    else if (id === 'data') { dOff = body; dLen = size; }
    o = body + size + (size % 2);
  }
  const n = Math.floor(dLen / 2 / fmt.ch), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = buf.readInt16LE(dOff + i * fmt.ch * 2) / 32768;
  return { samples: mono, sampleRate: fmt.sr };
}

// 平均化デシメーション(簡易アンチエイリアス)。
function resample(s, from, to) {
  if (from === to) return s;
  const ratio = from / to, outLen = Math.floor(s.length / ratio), out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const a = Math.floor(i * ratio), b = Math.min(s.length, Math.floor((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = a; j < b; j++) { sum += s[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function runOver(session, samples) {
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SR)]), [1]);
  let h = new Float32Array(2 * 1 * 64), c = new Float32Array(2 * 1 * 64);
  const probs = [];
  for (let off = 0; off + FRAME <= samples.length; off += FRAME) {
    const out = await session.run({
      input: new ort.Tensor('float32', samples.slice(off, off + FRAME), [1, FRAME]),
      sr,
      h: new ort.Tensor('float32', h, [2, 1, 64]),
      c: new ort.Tensor('float32', c, [2, 1, 64]),
    });
    h = Float32Array.from(out.hn.data);
    c = Float32Array.from(out.cn.data);
    probs.push(out.output.data[0]);
  }
  return probs;
}

function summarize(label, probs) {
  const max = Math.max(...probs).toFixed(3);
  const speech = probs.filter((x) => x >= 0.5).length;
  console.log(`${label}: frames=${probs.length} max=${max} speech(>=.5)=${speech} (${((speech / probs.length) * 100).toFixed(0)}%)`);
}

async function main() {
  if (!(await exists(modelPath))) {
    console.error('✗ resources/silero_vad.onnx が無い。先に node scripts/download-vad-model.mjs');
    process.exit(1);
  }
  const session = await ort.InferenceSession.create(modelPath);
  console.log('VAD: silero v4', session.inputNames, '->', session.outputNames, '\n');

  summarize('無音2s   ', await runOver(session, new Float32Array(SR * 2)));
  for (const f of ['torimi_01.wav', 'torimi_02.wav', 'torimi_03.wav']) {
    const p = path.join(root, 'voice-smoke-out', f);
    if (!(await exists(p))) { console.log(`skip ${f}`); continue; }
    const { samples, sampleRate } = parseWav(await readFile(p));
    summarize(`${f}`, await runOver(session, resample(samples, sampleRate, SR)));
  }
  console.log('\n→ 無音は低く(<0.5)、発話は高い(≈1.0)なら OK。本番はマイクをネイティブ16kHzで取る。');
}

main().catch((e) => { console.error(e); process.exit(1); });

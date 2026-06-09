// VAD 負荷シミュレーション(2026-06-10・一時診断ツール)。
//
// 仮説: 実機の分断は「自然な間が800ms超え」ではなく、ライブ経路の負荷で
//   (A) マイク取り込み(ScriptProcessorNode 512)が隙間を空ける / (B) pushFrame の busy でフレーム脱落
//   が起き、ステートフルな Silero VAD が壊れて発話中に確率が落ちる、というもの。
//
// ここでは clean な合成音声(前段 vad-fragment-test が書いた commas.wav)を使い:
//   1) 1フレームの推論時間(avg/p95/max)を測る → 32ms に対して busy 脱落が起こりうるか
//   2) フレームを r% ランダム脱落させ「残りを連続して」VAD に通す(=本番の busy 脱落と同じ状況)
//      → 発話中の確率が落ちて 800ms でも分断が出るかを見る
//
// 使い方: node scripts/vad-fragment-test.mjs を先に1回 → node scripts/vad-load-sim.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as ort from 'onnxruntime-node';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = path.join(root, 'resources', 'silero_vad.onnx');
const wavPath = path.join(root, 'voice-smoke-out', 'vad-frag', 'commas.wav');

const FRAME = 512, SR = 16000, FRAME_MS = (FRAME / SR) * 1000;
const SPEECH_TH = 0.5, SILENCE_TH = 0.35, MIN_SPEECH_MS = 160, MIN_SILENCE_MS = 800;

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
  return mono;
}

function frames(samples) {
  const fr = [];
  for (let off = 0; off + FRAME <= samples.length; off += FRAME) fr.push(samples.slice(off, off + FRAME));
  return fr;
}

// keepMask[i]=false のフレームは「脱落」=VADに渡さない(状態も進めない)。残りを連続投入。
async function vadProbs(session, frameList, keepMask) {
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SR)]), [1]);
  let h = new Float32Array(2 * 1 * 64), c = new Float32Array(2 * 1 * 64);
  const probs = []; const times = [];
  for (let i = 0; i < frameList.length; i++) {
    if (keepMask && !keepMask[i]) continue;
    const t0 = performance.now();
    const out = await session.run({
      input: new ort.Tensor('float32', frameList[i], [1, FRAME]),
      sr,
      h: new ort.Tensor('float32', h, [2, 1, 64]),
      c: new ort.Tensor('float32', c, [2, 1, 64]),
    });
    times.push(performance.now() - t0);
    h = Float32Array.from(out.hn.data);
    c = Float32Array.from(out.cn.data);
    probs.push(out.output.data[0]);
  }
  return { probs, times };
}

function segmentCount(probs, minSilenceMs) {
  const minSil = Math.max(1, Math.round(minSilenceMs / FRAME_MS));
  const minSp = Math.max(1, Math.round(MIN_SPEECH_MS / FRAME_MS));
  let trig = false, sp = 0, sil = 0, n = 0;
  for (const p of probs) {
    if (!trig) { if (p >= SPEECH_TH) { sp++; if (sp >= minSp) { trig = true; sil = 0; } } else sp = 0; }
    else { if (p < SILENCE_TH) { sil++; if (sil >= minSil) { n++; trig = false; sp = 0; sil = 0; } } else sil = 0; }
  }
  if (trig) n++;
  return n;
}

// 決定的な擬似乱数(再現性のため)。
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function main() {
  const samples = parseWav(await readFile(wavPath));
  const fr = frames(samples);
  const session = await ort.InferenceSession.create(modelPath);

  // 1) ベースライン(全フレーム)＋推論時間
  const base = await vadProbs(session, fr, null);
  const ts = base.times.slice().sort((a, b) => a - b);
  const avg = (ts.reduce((s, x) => s + x, 0) / ts.length);
  const p95 = ts[Math.floor(ts.length * 0.95)];
  const max = ts[ts.length - 1];
  const speechPct = Math.round((base.probs.filter((x) => x >= SPEECH_TH).length / base.probs.length) * 100);
  console.log(`frames=${fr.length}  推論時間/フレーム: avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms (frame間隔=${FRAME_MS}ms)`);
  console.log(`baseline(脱落なし): speech=${speechPct}%  分断@800ms=${segmentCount(base.probs, 800)}個\n`);

  // 2) フレーム脱落シミュレーション(busy 脱落=状態が discontinuous になる)
  console.log('フレームを r% 脱落させ、残りを連続投入(=本番 busy 脱落と同じ)→ 800ms での分断:');
  for (const r of [0.1, 0.2, 0.3, 0.5]) {
    const rng = mulberry32(12345);
    const keep = fr.map(() => rng() >= r);
    const { probs } = await vadProbs(session, fr, keep);
    const sp = Math.round((probs.filter((x) => x >= SPEECH_TH).length / probs.length) * 100);
    console.log(`  脱落 ${Math.round(r * 100)}% → 残frames=${probs.length} speech=${sp}%  分断@800ms=${segmentCount(probs, 800)}個`);
  }
  console.log('\n読み方: 推論 avg が 32ms に近い/超える、または脱落で分断が増えるなら、ライブ負荷が原因。');
}

main().catch((e) => { console.error(e); process.exit(1); });

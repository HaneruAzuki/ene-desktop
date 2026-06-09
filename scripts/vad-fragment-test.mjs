// VAD 分断(細切れ確定)の原因究明ハーネス(2026-06-10・一時診断ツール)。
//
// 狙い: 「ハンズフリーで発話が 8/21/38/5… 字に細切れ確定する」のは本当に
//   『自然な間が VAD_MIN_SILENCE_MS(=800ms)を超えているから』なのかを、実測で確かめる。
//
// 方法: テキスト(=Claudeが生成した会話的な長文)を AivisSpeech で 16kHz 合成し、
//   本番と同一の Silero VAD(v4)に通して発話確率列を得る。さらに本番の VadSegmenter と
//   同一ロジック・同一定数で speech-start/end を再現し、
//     ・各 speech-end を起こした「無音ラン長(ms)」
//     ・発話中に出現した無音ギャップの分布(自然な間が何msまで伸びるか)
//     ・しきい値 {350,500,800,1200} ごとの分断数
//   を出す。これで「800ms 超えが原因か/別バグか」を切り分ける。
//
// 使い方: AivisSpeech(localhost:10101)起動 + torimi.aivmx 配置 → node scripts/vad-fragment-test.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = path.join(root, 'resources', 'silero_vad.onnx');
const voiceJsonPath = path.join(root, 'characters', 'ene', 'voice.json');
const outDir = path.join(root, 'voice-smoke-out', 'vad-frag');

const FRAME = 512;
const SR = 16000;
const FRAME_MS = (FRAME / SR) * 1000; // 32ms

// 本番 constants.ts と一致させる(VadSegmenter / DEFAULT_VAD_CONFIG)。
const SPEECH_TH = 0.5;
const SILENCE_TH = 0.35;
const MIN_SPEECH_MS = 160;
const MIN_SILENCE_MS = 800; // ← 現在値。下のスイープで他値も評価する。

// Claude(私)が生成した、デスクトップの相棒に話しかける会話的な長文。話し方の癖を変えた3種。
const TEXTS = [
  {
    id: 'commas',
    note: '読点多めで一息に話す(言い淀み風の短い間が多い)',
    text:
      'ねえ聞いてよ、今日さ、朝から本当にいろいろあってね、まず起きたら寝坊しててさ、慌てて支度して家を出たんだけど、駅に着いたらちょうど電車が行っちゃったところでね、次のを待ってたんだよ、そしたら今度は遅延してたみたいでさ、もう本当についてないなあって思いながら、なんとか会社に着いたんだけどね、午前中はずっと会議が詰まっててさ、お昼を食べる時間もなくて、午後になってやっと一息つけたと思ったらね、急な頼まれごとが入ってきてさ、結局定時には全然終わらなくて、しっかり残業してたんだよ',
  },
  {
    id: 'periods',
    note: '句点で文を区切る(文末で声が小さく落ちる→無音が伸びやすい)',
    text:
      'あのね、ちょっと相談したいことがあるんだ。最近、仕事のことで悩んでてさ。今の部署にいてもいいのか、ずっと考えてるんだよね。やりたいことは別にあるんだけど、勇気が出なくて。でも、このままでいいのかなって思うんだ。トリミはどう思う。',
  },
  {
    id: 'hesitant',
    note: '言い淀み・考えながら(「えっと」「うーん」の間が長め)',
    text:
      'えっとね、なんていうか、うまく言えないんだけど、最近ちょっと疲れてて。うーん、なんだろう、別に大きな理由があるわけじゃないんだけど、なんとなく気分が乗らなくて。まあ、そういう時もあるよね。',
  },
];

const PARAM_KEYS = ['speedScale', 'intonationScale', 'tempoDynamicsScale', 'volumeScale'];

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

async function synth(baseUrl, styleId, params, text) {
  const qRes = await fetch(`${baseUrl}/audio_query?speaker=${styleId}&text=${encodeURIComponent(text)}`, { method: 'POST' });
  if (!qRes.ok) throw new Error(`audio_query ${qRes.status}`);
  const query = await qRes.json();
  for (const k of PARAM_KEYS) if (typeof params[k] === 'number') query[k] = params[k];
  query.outputSamplingRate = SR; // 16kHz で受け取り、リサンプル誤差を避ける
  const sRes = await fetch(`${baseUrl}/synthesis?speaker=${styleId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify(query),
  });
  if (!sRes.ok) throw new Error(`synthesis ${sRes.status}`);
  return Buffer.from(await sRes.arrayBuffer());
}

async function vadProbs(session, samples) {
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

// 本番 VadSegmenter.push() と同一ロジック。speech-end を起こした無音ラン長(frames)も返す。
function segment(probs, minSilenceMs) {
  const minSilenceFrames = Math.max(1, Math.round(minSilenceMs / FRAME_MS));
  const minSpeechFrames = Math.max(1, Math.round(MIN_SPEECH_MS / FRAME_MS));
  let triggered = false, speechFrames = 0, silenceFrames = 0;
  const segs = []; // {startF, endF, endSilenceFrames}
  let startF = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (!triggered) {
      if (p >= SPEECH_TH) {
        speechFrames++;
        if (speechFrames >= minSpeechFrames) { triggered = true; silenceFrames = 0; startF = i - speechFrames + 1; }
      } else speechFrames = 0;
    } else {
      if (p < SILENCE_TH) {
        silenceFrames++;
        if (silenceFrames >= minSilenceFrames) {
          segs.push({ startF, endF: i, endSilenceFrames: silenceFrames });
          triggered = false; speechFrames = 0; silenceFrames = 0;
        }
      } else silenceFrames = 0;
    }
  }
  if (triggered) segs.push({ startF, endF: probs.length - 1, endSilenceFrames: silenceFrames });
  return segs;
}

// 発話「中」に出現する無音ラン(< SILENCE_TH の連続)を全部集める=自然な間の分布。
// triggered 中だけを対象に、ランが途切れた(発話再開)時点で記録する。
function innerSilenceRuns(probs) {
  const minSpeechFrames = Math.max(1, Math.round(MIN_SPEECH_MS / FRAME_MS));
  let triggered = false, speechFrames = 0, run = 0;
  const runs = [];
  for (const p of probs) {
    if (!triggered) {
      if (p >= SPEECH_TH) { speechFrames++; if (speechFrames >= minSpeechFrames) { triggered = true; } }
      else speechFrames = 0;
    } else {
      if (p < SILENCE_TH) run++;
      else { if (run > 0) runs.push(run); run = 0; }
    }
  }
  return runs.map((f) => Math.round(f * FRAME_MS)).sort((a, b) => b - a);
}

const fmtMs = (f) => `${Math.round(f * FRAME_MS)}ms`;

async function main() {
  const config = JSON.parse(await readFile(voiceJsonPath, 'utf8'));
  const baseUrl = (config.baseUrl ?? 'http://127.0.0.1:10101').replace(/\/+$/, '');
  const params = config.styles?.neutral ?? { styleId: 0 };
  const styleId = params.styleId ?? 0;
  await mkdir(outDir, { recursive: true });

  const session = await ort.InferenceSession.create(modelPath);
  console.log(`VAD silero v4 / frame=${FRAME} (${FRAME_MS}ms) / speechTh=${SPEECH_TH} silenceTh=${SILENCE_TH} minSpeech=${MIN_SPEECH_MS}ms`);
  console.log(`styleId=${styleId}\n`);

  const SWEEP = [350, 500, 800, 1200];

  for (const t of TEXTS) {
    let wav;
    try { wav = await synth(baseUrl, styleId, params, t.text); }
    catch (e) { console.error(`✗ synth ${t.id}: ${e.message}`); continue; }
    await writeFile(path.join(outDir, `${t.id}.wav`), wav);
    const { samples, sampleRate } = parseWav(wav);
    const probs = await vadProbs(session, samples);
    const durMs = Math.round((samples.length / sampleRate) * 1000);
    const speechPct = Math.round((probs.filter((x) => x >= SPEECH_TH).length / probs.length) * 100);

    console.log(`━━━ [${t.id}] ${t.note}`);
    console.log(`    「${t.text.slice(0, 28)}…」(${t.text.length}字)`);
    console.log(`    音声長=${durMs}ms  frames=${probs.length}  speech(>=.5)=${speechPct}%`);

    const runs = innerSilenceRuns(probs);
    const top = runs.slice(0, 6);
    console.log(`    発話中の無音ギャップ上位: ${top.length ? top.map((m) => m + 'ms').join(', ') : '(なし)'}`);
    console.log(`    → 800ms 以上のギャップ数: ${runs.filter((m) => m >= 800).length} / 全ギャップ ${runs.length}`);

    for (const ms of SWEEP) {
      const segs = segment(probs, ms);
      const detail = segs.map((s) => `${fmtMs(s.startF)}-${fmtMs(s.endF)}`).join(' | ');
      console.log(`    minSilence=${String(ms).padStart(4)}ms → 分断=${segs.length}個  [${detail}]`);
    }
    console.log('');
  }

  console.log('読み方:');
  console.log('  ・「800ms以上のギャップ数」が 0 なのに minSilence=800 で分断>1 なら、原因は別(無音判定/フレーム以外)。');
  console.log('  ・ギャップが実際に 800ms 超えなら「自然な間が長い」が原因=しきい値では本質的に解けない。');
  console.log(`  出力 WAV: ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

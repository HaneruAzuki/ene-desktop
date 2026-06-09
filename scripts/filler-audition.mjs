// 思考フィラー/相槌 候補の試聴用合成(一時ツール・B-15/task_18 のチューニング用)。
//
// 起動中の AivisSpeech(localhost:10101・voice.json の baseUrl)に繋ぎ、候補語を魚川トリミの声で
// 相槌相当のテンポ(speedScale 0.92)で合成して voice-smoke-out/fillers/ に WAV 保存する。
// ユーザーが各 WAV を再生して、どの語を採用するか耳で選ぶためのもの(人間判定)。
//
// 使い方: node scripts/filler-audition.mjs   (AivisSpeech 起動中=アプリ起動中であること)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const voiceJsonPath = path.join(root, 'characters', 'ene', 'voice.json');
const outDir = path.join(root, 'voice-smoke-out', 'fillers');

// 各語ごとに [name, text, speed]。相槌はゆっくり(0.85)、フィラーは 0.92。volume は試聴 1.0。

// [name, text, speed, accent|null]。accent=最後の accent_phrase の下げ位置(1=頭で下降, null=既定)。
// 「そうね」は既定 accent=3(平板=高高高=フラット)。前に寄せると下降して自然になる。
const AIZUCHI = [
  ['soune_def', 'そうね', 0.92, null], // 既定(高高高・比較用)
  ['soune_a1', 'そうね', 0.92, 1], // 高低低(頭高)
  ['soune_a2', 'そうね', 0.92, 2], // 高高低
  ['nsoune_def', 'んーー…そうね', 0.92, null],
  ['nsoune_a1', 'んーー…そうね', 0.92, 1], // そうね 部分を頭高に
  ['nsoune_a2', 'んーー…そうね', 0.92, 2],
];

const FILLERS = [];

async function synth(baseUrl, styleId, params, text, speed, accent = null) {
  const qRes = await fetch(`${baseUrl}/audio_query?speaker=${styleId}&text=${encodeURIComponent(text)}`, {
    method: 'POST',
  });
  if (!qRes.ok) throw new Error(`audio_query ${qRes.status}`);
  const query = await qRes.json();
  // accent 指定があれば**最後の accent_phrase**の下げ位置を変更(下降イントネーション化)。
  if (accent !== null && Array.isArray(query.accent_phrases) && query.accent_phrases.length > 0) {
    const ap = query.accent_phrases[query.accent_phrases.length - 1];
    ap.accent = Math.min(accent, ap.moras.length);
  }
  // voice.json の neutral パラメータ＋相槌テンポを反映(pitchScale は触らない=設計)。
  if (typeof params.intonationScale === 'number') query.intonationScale = params.intonationScale;
  if (typeof params.tempoDynamicsScale === 'number') query.tempoDynamicsScale = params.tempoDynamicsScale;
  query.speedScale = (params.speedScale ?? 1) * speed;
  query.volumeScale = 1.0;
  const sRes = await fetch(`${baseUrl}/synthesis?speaker=${styleId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify(query),
  });
  if (!sRes.ok) throw new Error(`synthesis ${sRes.status}`);
  return Buffer.from(await sRes.arrayBuffer());
}

async function main() {
  const config = JSON.parse(await readFile(voiceJsonPath, 'utf8'));
  const baseUrl = (config.baseUrl ?? 'http://127.0.0.1:10101').replace(/\/+$/, '');
  const params = config.styles?.neutral ?? { styleId: 0 };
  const styleId = params.styleId ?? 0;

  await mkdir(outDir, { recursive: true });
  console.log(`styleId=${styleId} → ${outDir}\n`);

  for (const [name, text, speed, accent] of [...AIZUCHI, ...FILLERS]) {
    try {
      const wav = await synth(baseUrl, styleId, params, text, speed, accent ?? null);
      const out = path.join(outDir, `${name}.wav`);
      await writeFile(out, wav);
      console.log(`✓ ${name}.wav  「${text}」 (speed ${speed}, accent ${accent ?? '既定'})`);
    } catch (e) {
      console.error(`✗ ${name}  「${text}」: ${e.message}`);
    }
  }
  console.log(`\n出力先: ${outDir}\n各 WAV を再生して、採用するフィラー/相槌を選んでください(人間判定)。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

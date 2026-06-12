// 音声スモークテスト(task_17 Phase A・手動検証用)。
//
// 起動中の AivisSpeech(localhost:10101)に繋ぎ、魚川トリミの声で数文を合成して WAV を書き出す。
// フル Electron 配線の前に「実エンジン＋声モデル＋voice.json のパラメータ」を一発で確認するためのもの。
//
// 使い方:
//   1. AivisSpeech(または AivisSpeech-Engine の run.exe)を起動 → http://127.0.0.1:10101 が立つ
//   2. torimi.aivmx を %APPDATA%\AivisSpeech-Engine\Models\ に配置
//   3. node scripts/voice-smoke.mjs   (または npm run voice:smoke)
//   4. voice-smoke-out/ の WAV を再生して声を確認。出力された styleId を ene/voice.json に反映可。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const voiceJsonPath = path.join(root, 'characters', 'ene', 'voice.json');
const outDir = path.join(root, 'voice-smoke-out');

// トリミらしさ(ツン↔デレ)を耳で判定できる台詞。単一スタイルでも内容で雰囲気を確認。
const SENTENCES = [
  'こんにちは、魚川トリミだよ。',
  '別にあんたのために来たわけじゃないんだからね。',
  '……ありがと。ちょっとだけ、嬉しいかも。',
];

const PARAM_KEYS = ['speedScale', 'intonationScale', 'tempoDynamicsScale', 'volumeScale'];

/** audio_query に voice.json のパラメータを反映する(pitchScale は触らない=設計)。 */
function applyParams(query, params) {
  for (const k of PARAM_KEYS) {
    if (typeof params[k] === 'number') query[k] = params[k];
  }
  return query;
}

async function main() {
  const config = JSON.parse(await readFile(voiceJsonPath, 'utf8'));
  const baseUrl = (config.baseUrl ?? 'http://127.0.0.1:10101').replace(/\/+$/, '');
  const params = config.styles?.neutral ?? { styleId: 0 };

  // 1. /speakers で実スタイル(グローバル styleId)を確認
  let speakers;
  try {
    const res = await fetch(`${baseUrl}/speakers`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    speakers = await res.json();
  } catch (e) {
    console.error(`✗ AivisSpeech に繋がりません (${baseUrl})。`);
    console.error('  エンジンを起動し、torimi.aivmx を Models フォルダへ置いてから再実行してください。');
    console.error(`  詳細: ${e.message}`);
    process.exit(1);
  }

  console.log('— /speakers —');
  const flat = [];
  for (const sp of speakers) {
    for (const st of sp.styles ?? []) {
      flat.push({ name: `${sp.name}/${st.name}`, id: st.id });
      console.log(`  ${sp.name} / ${st.name}  → styleId ${st.id}`);
    }
  }
  // 魚川トリミ優先 → ノーマル → 先頭、の順で1スタイル選ぶ
  const pick =
    flat.find((s) => s.name.includes('魚川トリミ')) ??
    flat.find((s) => s.name.includes('ノーマル')) ??
    flat[0];
  const styleId = pick?.id ?? params.styleId ?? 0;
  console.log(`\n→ 使用 styleId: ${styleId}  (${pick?.name ?? '?'})`);
  console.log('   ※ この styleId を ene/voice.json の neutral.styleId に反映できます\n');

  await mkdir(outDir, { recursive: true });

  // 2. 各文を合成して WAV 出力
  for (let i = 0; i < SENTENCES.length; i++) {
    const text = SENTENCES[i];
    const qRes = await fetch(
      `${baseUrl}/audio_query?speaker=${styleId}&text=${encodeURIComponent(text)}`,
      { method: 'POST' },
    );
    if (!qRes.ok) {
      console.error(`✗ audio_query 失敗(文${i + 1}): ${qRes.status}`);
      continue;
    }
    const query = applyParams(await qRes.json(), params);
    const sRes = await fetch(`${baseUrl}/synthesis?speaker=${styleId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
      body: JSON.stringify(query),
    });
    if (!sRes.ok) {
      console.error(`✗ synthesis 失敗(文${i + 1}): ${sRes.status}`);
      continue;
    }
    const out = path.join(outDir, `torimi_${String(i + 1).padStart(2, '0')}.wav`);
    await writeFile(out, Buffer.from(await sRes.arrayBuffer()));
    console.log(`✓ ${out}  「${text}」`);
  }

  console.log(`\n出力先: ${outDir}`);
  console.log('WAV を再生して、声がイメージどおりか確認してください(人間判定)。');
  if (config.credit) console.log(`\n[必須クレジット] ${config.credit}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

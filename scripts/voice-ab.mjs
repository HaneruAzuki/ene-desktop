// 音声 A/B テスト(task_17・読み間違い対策の検証用)。
// 同じ文を (a)漢字そのまま と (b)Claude生成のひらがな読み で合成し、誤読・抑揚を聴き比べる。
// 使い方: AivisSpeech 起動中に  node scripts/voice-ab.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'voice-smoke-out');

// 誤読しやすい要素(固有名詞・数字+助数詞・同表記異音・文脈依存)を含むトリミ口調の例文。
const PAIRS = [
  { id: '01', kanji: '魚川トリミだよ。今日は朝から機嫌が悪いんだから。', kana: 'うおかわトリミだよ。きょうはあさからきげんがわるいんだから。' },
  { id: '02', kanji: '別に、あんたのために十分待ったわけじゃないし。', kana: 'べつに、あんたのためにじゅうぶんまったわけじゃないし。' },
  { id: '03', kanji: '昨日は一日中、本を読んでた。3冊も。', kana: 'きのうはいちにちじゅう、ほんをよんでた。さんさつも。' },
  { id: '04', kanji: '私の辛いところ、わかってないでしょ。', kana: 'わたしのつらいところ、わかってないでしょ。' },
];

const PARAM_KEYS = ['speedScale', 'intonationScale', 'tempoDynamicsScale', 'volumeScale'];

async function synth(baseUrl, styleId, params, text, outPath) {
  const q = await (
    await fetch(`${baseUrl}/audio_query?speaker=${styleId}&text=${encodeURIComponent(text)}`, { method: 'POST' })
  ).json();
  for (const k of PARAM_KEYS) if (typeof params[k] === 'number') q[k] = params[k];
  const res = await fetch(`${baseUrl}/synthesis?speaker=${styleId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify(q),
  });
  if (!res.ok) throw new Error(`synthesis ${res.status}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const config = JSON.parse(await readFile(path.join(root, 'characters', 'ene', 'voice.json'), 'utf8'));
  const baseUrl = (config.baseUrl ?? 'http://127.0.0.1:10101').replace(/\/+$/, '');
  const params = config.styles?.neutral ?? { styleId: 0 };

  const speakers = await (await fetch(`${baseUrl}/speakers`)).json();
  const flat = [];
  for (const sp of speakers) for (const st of sp.styles ?? []) flat.push({ name: `${sp.name}/${st.name}`, id: st.id });
  const pick = flat.find((s) => s.name.includes('魚川トリミ')) ?? flat.find((s) => s.name.includes('ノーマル')) ?? flat[0];
  const styleId = pick?.id ?? params.styleId ?? 0;
  console.log(`styleId: ${styleId} (${pick?.name})\n`);

  await mkdir(outDir, { recursive: true });
  for (const p of PAIRS) {
    const aPath = path.join(outDir, `ab_${p.id}_a_kanji.wav`);
    const bPath = path.join(outDir, `ab_${p.id}_b_kana.wav`);
    await synth(baseUrl, styleId, params, p.kanji, aPath);
    await synth(baseUrl, styleId, params, p.kana, bPath);
    console.log(`[${p.id}]`);
    console.log(`  (a)漢字: ${p.kanji}`);
    console.log(`  (b)かな: ${p.kana}`);
  }
  console.log(`\n出力: ${outDir}  (ab_*_a_kanji.wav / ab_*_b_kana.wav)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

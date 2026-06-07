// ruri-v3-310m(ONNX・int8)をローカルへダウンロードするセットアップ用スクリプト。
//
// 位置づけ(重要):
//   - これは「開発・セットアップ時に手動実行」するツール。配布物(exe)には含めない。
//   - アプリ本体は実行時に外部へモデルを取りに行かない(§7.1)。モデルはこのスクリプトで
//     事前にローカル配置し、アプリは data/models/ruri-v3-310m/ から読むだけ。
//   - 既定の取得元は Apache-2.0 のコミュニティ ONNX 変換リポジトリ。
//
// 使い方:  node scripts/download-model.mjs
//   環境変数 ENE_MODEL_REPO で取得元、ENE_MODEL_VARIANT で量子化(既定 model_quantized=int8)を変更可。

import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = process.env.ENE_MODEL_REPO ?? 'sirasagi62/ruri-v3-310m-ONNX';
const VARIANT = process.env.ENE_MODEL_VARIANT ?? 'model_quantized'; // int8(約316MB)
const DEST_ROOT = join(process.cwd(), 'data', 'models', 'ruri-v3-310m');

// transformers.js が dtype:'q8' で参照する標準レイアウトに合わせる。
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'tokenizer.model',
  `onnx/${VARIANT}.onnx`,
];

function resolveUrl(repo, path) {
  return `https://huggingface.co/${repo}/resolve/main/${path}`;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download(repo, relPath, destRoot) {
  const dest = join(destRoot, relPath);
  if (await exists(dest)) {
    console.log(`skip (exists): ${relPath}`);
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  const url = resolveUrl(repo, relPath);
  console.log(`downloading: ${relPath} ...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`failed ${res.status} ${res.statusText}: ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`  done: ${relPath}`);
}

async function main() {
  console.log(`model repo: ${REPO}`);
  console.log(`variant   : ${VARIANT}`);
  console.log(`dest      : ${DEST_ROOT}`);
  for (const f of FILES) {
    await download(REPO, f, DEST_ROOT);
  }
  console.log('\n完了。data/models/ruri-v3-310m/ にモデルを配置しました。');
  console.log('アプリを起動すると意味(ベクトル)想起が有効になります(未配置時は語彙のみで動作)。');
}

main().catch((e) => {
  console.error('モデル取得に失敗しました:', e.message);
  process.exitCode = 1;
});

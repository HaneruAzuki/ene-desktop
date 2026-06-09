// STT モデル(ONNX)をローカルへダウンロードするセットアップ用スクリプト(task_17 Phase B)。
// 既定モデルは whisper-small(2026-06-09 計測で turbo→small へ・N-LAT-6)。
//
// 位置づけ(download-model.mjs と同じ):
//   - 「開発・セットアップ時に手動実行」するツール。配布物(exe)には含めない。
//   - アプリ本体は実行時に外部へモデルを取りに行かない(§7.1)。モデルはこのスクリプトで
//     事前にローカル配置し、アプリは data/models/whisper-small/ から読むだけ。
//
// 使い方:  node scripts/download-stt-model.mjs   (既定=whisper-small)
//   環境変数 ENE_STT_REPO で取得元リポジトリを、ENE_STT_DIR で配置先ディレクトリ名を変更可。
//   例(高精度モデルも併せて取得):
//     ENE_STT_REPO=onnx-community/whisper-large-v3-turbo ENE_STT_DIR=whisper-large-v3-turbo node scripts/download-stt-model.mjs
//   アプリ側は ENE_STT_MODEL_DIR=<dir> で読み先を切替える。

import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = process.env.ENE_STT_REPO ?? 'onnx-community/whisper-small';
// 配置先ディレクトリ名。未指定ならリポジトリ名の末尾(basename)を使う。
const DIR = process.env.ENE_STT_DIR ?? REPO.split('/').pop();
const DEST_ROOT = join(process.cwd(), 'data', 'models', DIR);

// 精度優先: encoder は fp32。decoder は量子化(q8=_quantized)で十分(サイズ/速度が有利)。
const ENCODER = 'onnx/encoder_model.onnx';
const DECODER_PREFERRED = 'onnx/decoder_model_merged_quantized.onnx'; // q8
const DECODER_FALLBACK = 'onnx/decoder_model_merged.onnx'; // fp32

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

/** HF API でリポジトリのファイル一覧(siblings)を取得する。 */
async function listFiles(repo) {
  const res = await fetch(`https://huggingface.co/api/models/${repo}`);
  if (!res.ok) throw new Error(`HF API failed ${res.status} ${res.statusText}`);
  const json = await res.json();
  return (json.siblings ?? []).map((s) => s.rfilename);
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
  console.log(`dest      : ${DEST_ROOT}`);

  const files = await listFiles(REPO);

  // ルート直下の設定/トークナイザ系(.json / .txt)はすべて取得する
  // (config / generation_config / preprocessor_config / tokenizer 等を漏れなく)。
  const configFiles = files.filter(
    (f) => !f.includes('/') && (f.endsWith('.json') || f.endsWith('.txt')),
  );

  // decoder は量子化があれば優先、無ければ fp32。
  const decoder = files.includes(DECODER_PREFERRED) ? DECODER_PREFERRED : DECODER_FALLBACK;
  console.log(`decoder   : ${decoder}`);

  // 大きい ONNX は重みを外部ファイル(<name>.onnx_data)に分離している(ONNX external data 形式)。
  // 連れファイルがリポジトリに在れば必ず一緒に取得する(無いと読み込み時に失敗する)。
  const onnxFiles = [ENCODER, decoder];
  const externalData = onnxFiles.map((f) => `${f}_data`).filter((f) => files.includes(f));

  const toGet = [...configFiles, ...onnxFiles, ...externalData];
  for (const f of toGet) {
    await download(REPO, f, DEST_ROOT);
  }

  console.log(`\n完了。data/models/${DIR}/ にモデルを配置しました。`);
  console.log('既定(whisper-large-v3-turbo)以外を試すときは ENE_STT_MODEL_DIR=' + DIR + ' でアプリを起動。');
}

main().catch((e) => {
  console.error('モデル取得に失敗しました:', e.message);
  process.exitCode = 1;
});

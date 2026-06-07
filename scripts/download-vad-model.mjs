// Silero VAD(ONNX・MIT)を resources/ へ配置するセットアップ用スクリプト(task_17 Phase C)。
//
// 位置づけ:
//   - Silero VAD は約1.8MBと小さいので **配布物(exe)に同梱**する(STT/embedding の data/models 別DLとは異なる)。
//   - よって取得先は resources/(app.getAppPath()/resources・配布に含まれる)。リポジトリにもコミットする。
//   - アプリ実行時は外部に取りに行かない(§7.1)。このスクリプトは開発/セットアップ時に1回だけ実行。
//
// 使い方:  node scripts/download-vad-model.mjs

import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Silero VAD v4(snakers4/silero-vad・MIT)。16kHz は 512 サンプル/フレーム。
// ★ v5(input/state/sr)は onnxruntime-node が If/動的形状を誤計算し実音声でも確率≈0 になる
//    (実機検証で確認・N-17-9)。v4(input/sr/h/c=h/c分離)は onnxruntime-node で正しく動くため v4 を採用。
const URL =
  process.env.ENE_VAD_URL ??
  'https://raw.githubusercontent.com/snakers4/silero-vad/v4.0/files/silero_vad.onnx';
const DEST = join(process.cwd(), 'resources', 'silero_vad.onnx');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await exists(DEST)) {
    console.log(`skip (exists): ${DEST}`);
    return;
  }
  await mkdir(dirname(DEST), { recursive: true });
  console.log(`downloading Silero VAD ...\n  ${URL}`);
  const res = await fetch(URL);
  if (!res.ok || !res.body) {
    throw new Error(`failed ${res.status} ${res.statusText}: ${URL}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(DEST));
  const { size } = await stat(DEST);
  console.log(`done: ${DEST} (${(size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error('VAD モデル取得に失敗しました:', e.message);
  process.exitCode = 1;
});

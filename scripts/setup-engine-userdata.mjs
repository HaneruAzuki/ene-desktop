// 配布同梱用: エンジンのユーザデータ root(torimi モデル＋BERT)を data/voice/userdata へ配置する。
//
// 位置づけ(download-*.mjs / setup-voice-engine.mjs と同じ): 開発・ビルド時に手動実行するツール。
// 配布物には含めない(配置結果の data/voice/userdata が electron-builder の extraFiles で同梱される)。
//
// 背景(N-17-13): AivisSpeech エンジンは声モデル(.aivmx)と BERT を %APPDATA%\AivisSpeech-Engine へ
// 保存する(保存先は変更不可)。ポータブル化のため、それらをここでポータブル側 data/voice/userdata へ
// 取り込んでおき、実行時に %APPDATA% へジャンクションで「一時借用」する(engine-userdata.ts)。
//
// コピー元は既定で %APPDATA%\AivisSpeech-Engine(= 一度エンジンを起動して torimi 登録＋BERT 取得済みの状態)。
//   torimi の UUID は ene/voice.json から読む(ハードコードしない・§4.5)。
//
// 使い方:  node scripts/setup-engine-userdata.mjs
//   ENE_ENGINE_USERDATA_SRC でコピー元を変更可 / ENE_FORCE=1 で再コピー。

import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = process.env.ENE_ENGINE_USERDATA_SRC ?? join(process.env.APPDATA ?? '', 'AivisSpeech-Engine');
const DEST = join(process.cwd(), 'data', 'voice', 'userdata');
const FORCE = process.env.ENE_FORCE === '1';
const MODELS = 'Models';
const BERT = 'BertModelCaches';

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readUuid() {
  try {
    const raw = await readFile(join(process.cwd(), 'ene', 'voice.json'), 'utf8');
    const uuid = JSON.parse(raw).uuid;
    if (typeof uuid === 'string' && uuid.length > 0) return uuid;
  } catch {
    /* fallthrough */
  }
  return null;
}

async function main() {
  const uuid = await readUuid();
  if (!uuid) {
    console.error('ene/voice.json に uuid がありません。先に UUID を設定してください。');
    process.exitCode = 1;
    return;
  }
  console.log(`src : ${SRC}`);
  console.log(`dest: ${DEST}`);
  console.log(`uuid: ${uuid}`);

  const modelSrc = join(SRC, MODELS, `${uuid}.aivmx`);
  const bertSrc = join(SRC, BERT);
  if (!(await exists(modelSrc))) {
    console.error(
      `\nモデルが見つかりません: ${modelSrc}\n` +
        `一度エンジンを起動して torimi を登録(＝<uuid>.aivmx が生成)してから実行してください。`,
    );
    process.exitCode = 1;
    return;
  }
  if (!(await exists(bertSrc))) {
    console.error(`\nBERT キャッシュが見つかりません: ${bertSrc}\n一度合成を実行して BERT を取得してから実行してください。`);
    process.exitCode = 1;
    return;
  }

  if ((await exists(join(DEST, MODELS, `${uuid}.aivmx`))) && !FORCE) {
    console.log('\n既に配置済みです(skip)。再コピーは ENE_FORCE=1 を付けてください。');
    return;
  }

  await mkdir(join(DEST, MODELS), { recursive: true });
  console.log('\nコピー中… (torimi モデル)');
  await cp(modelSrc, join(DEST, MODELS, `${uuid}.aivmx`), { force: true });
  console.log('コピー中… (BERT・大きいので時間がかかります)');
  await cp(bertSrc, join(DEST, BERT), { recursive: true, force: true });

  console.log('\n完了。data/voice/userdata に torimi＋BERT を配置しました(配布物に同梱されます)。');
  console.log('実行時はここを %APPDATA%\\AivisSpeech-Engine へジャンクションして一時借用します(N-17-13)。');
}

main().catch((e) => {
  console.error('配置に失敗しました:', e.message);
  process.exitCode = 1;
});

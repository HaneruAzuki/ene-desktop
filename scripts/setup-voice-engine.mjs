// AivisSpeech エンジン一式を data/voice/engine/ へ配置するセットアップ用スクリプト(task_17 / N-17-12)。
//
// 位置づけ(download-*.mjs と同じ):
//   - 「開発・ローカル検証時に手動実行」するツール。配布物(exe)には含めない。
//   - 配布時の取得は Phase 2(初回サイレント自動DL)で別実装する。これは手元で「声が出る」を
//     成立させるための配置ツール。
//   - エンジン本体は exe に同梱しない(コア<100MB維持・§4.3・N-17-6)。data/voice/ は .gitignore 済み。
//
// 使い方:  node scripts/setup-voice-engine.mjs
//   環境変数 ENE_AIVIS_ENGINE_SRC でコピー元(エンジン展開済みディレクトリ)を変更可。
//   環境変数 ENE_FORCE=1 で既存配置を上書き再コピー。

import { cp, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_SRC = 'C:\\Users\\masat\\ene-voice-build\\aivis-engine\\extracted\\Windows-x64';
const SRC = process.env.ENE_AIVIS_ENGINE_SRC ?? DEFAULT_SRC;
const DEST = join(process.cwd(), 'data', 'voice', 'engine');
const FORCE = process.env.ENE_FORCE === '1';

// GPU 用 DirectML.dll(~18MB)は CPU 限定方針(N-17-4)で不要。安全に削れる唯一の品なので除外する。
const EXCLUDE_BASENAMES = new Set(['DirectML.dll']);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`src : ${SRC}`);
  console.log(`dest: ${DEST}`);

  if (!(await exists(join(SRC, 'run.exe')))) {
    console.error(
      `\nコピー元に run.exe が見つかりません: ${SRC}\n` +
        `ENE_AIVIS_ENGINE_SRC で展開済みエンジンのディレクトリを指定してください。`,
    );
    process.exitCode = 1;
    return;
  }

  if ((await exists(join(DEST, 'run.exe'))) && !FORCE) {
    console.log('\n既に配置済みです(skip)。再コピーするには ENE_FORCE=1 を付けてください。');
    return;
  }

  await mkdir(DEST, { recursive: true });
  console.log('\nコピー中…(DirectML.dll は除外)');
  await cp(SRC, DEST, {
    recursive: true,
    force: true,
    // filter は「コピーするなら true」。DirectML.dll(GPU・不要)だけ落とす。
    filter: (source) => {
      const base = source.split(/[\\/]/).pop() ?? '';
      return !EXCLUDE_BASENAMES.has(base);
    },
  });

  console.log('\n完了。data/voice/engine/ にエンジンを配置しました。');
  console.log('アプリを起動すると AivisSpeech が自動で立ち上がり、声が出ます。');
  console.log('(声モデル torimi.aivmx は %APPDATA%\\AivisSpeech-Engine\\Models\\ にある必要があります)');
}

main().catch((e) => {
  console.error('エンジン配置に失敗しました:', e.message);
  process.exitCode = 1;
});

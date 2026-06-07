// 手動テスト用の「仮の記憶」を data/memory/ene/episodic/ に投入するスクリプト。
//
// 目的: 想起エンジン(task_15)が意図通りに動くかを、あなた(人間)が実アプリで確認するための土台。
//   - 人物で束ねる横断想起(田中さん)
//   - 意味の橋渡し(「赤点」→「テスト前/勉強」: ベクトル想起・モデル配置時のみ)
//   - 単純な好みの想起(ラーメン)
//   - 記憶更新(supersede/reattribute)の検証起点(鈴木が好き / 田中)
//
// 使い方:  node scripts/seed-recall-fixtures.mjs
//   開発時のデータ置き場(プロジェクト直下 data/)に書き込む。既存ファイルは上書きしない。
//   消したい場合は data/memory/ene/episodic/ を削除すればよい(物理削除でクリーン)。

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CHAR_ID = 'ene';
const ROOT = join(process.cwd(), 'data', 'memory', CHAR_ID, 'episodic');

/** ローカルTZ込み ISO をファイル名へ(":"→"-"・TZ 省略)。app の isoToFilename と同一規則。 */
function isoToFilename(iso) {
  return iso.replace(/([+-]\d{2}:\d{2}|Z)$/, '').replace(/:/g, '-');
}

function yearOf(iso) {
  return iso.slice(0, 4);
}

// 仮の記憶(中立観察・キャラ口調を混ぜない=抽出器の出力に倣う)。
const FIXTURES = [
  {
    date: '2025-09-12T19:30:00+09:00',
    topic: '田中さんと方針で衝突',
    summary: '会社の同僚の田中さんとプロジェクトの方針で衝突した。ユーザーは納得いかない様子だった。',
    tags: ['仕事', '衝突'],
    entities: ['田中'],
    importance: 3,
    category: 'work',
  },
  {
    date: '2026-03-20T21:00:00+09:00',
    topic: '田中さんとカラオケ',
    summary: '田中さんとカラオケに行って盛り上がった。前の衝突から仲直りできたようだ。',
    tags: ['カラオケ', '遊び'],
    entities: ['田中'],
    importance: 3,
    category: 'hobby',
  },
  {
    date: '2026-05-10T17:30:00+09:00',
    topic: '実力テスト前の過ごし方',
    summary: '実力テスト前なのに友達と遊びに行くと言った。ENEは勉強すべきだと反対し心配した。',
    tags: ['実力テスト', '勉強', '遊び'],
    entities: [],
    importance: 4,
    category: 'study',
  },
  {
    date: '2026-01-05T12:00:00+09:00',
    topic: '好きな食べ物',
    summary: 'お気に入りはラーメン。特に味噌ラーメンが好きだと言った。',
    tags: ['ラーメン', '食べ物'],
    entities: [],
    importance: 2,
    category: 'hobby',
  },
  {
    date: '2025-11-02T22:15:00+09:00',
    topic: '鈴木への気持ち',
    summary: '鈴木のことが好きだと打ち明けた。ENEは少し複雑な気持ちになった。',
    tags: ['恋愛'],
    entities: ['鈴木'],
    importance: 4,
    category: 'relationship',
  },
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let written = 0;
  for (const f of FIXTURES) {
    const path = join(ROOT, yearOf(f.date), f.category, `${isoToFilename(f.date)}.json`);
    if (await exists(path)) {
      console.log(`skip (exists): ${path}`);
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ schemaVersion: 2, ...f }, null, 2), 'utf8');
    console.log(`wrote: ${path}`);
    written++;
  }
  console.log(`\n完了。${written} 件の仮記憶を投入しました(全 ${FIXTURES.length} 件)。`);
  console.log('手順は tests/acceptance/memory-recall-manual.md を参照してください。');
}

main().catch((e) => {
  console.error('投入に失敗しました:', e.message);
  process.exitCode = 1;
});

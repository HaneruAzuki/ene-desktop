import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 記憶のエクスポート/インポート(N-REL-2)。
//
// 目的: (1) アンインストール前後や不具合時の**バックアップ**、(2) NSIS 化で失った**可搬性の回復**
//   (別PCへ記憶を引っ越す)。トリミとの記憶は作り直せないプロダクトの心臓なので、ユーザーが自分で
//   退避/復元できる手段を常設する(§6.4 データ所有権)。
//
// 対象 = ユーザーデータの「記憶」と「設定」。**APIキー(api-key.enc)は含めない**:DPAPI で機械/ユーザー固定の
//   暗号ゆえ別PCでは復号できず無意味で、かつ資格情報を平場のフォルダへ出さないため(§6.3)。
//
// 実装は純粋なファイル操作(ディレクトリ引数を受け取る)= electron 非依存・単体テスト可能。
// 呼び出し側(settings-ipc)が getUserDataDir() と選択フォルダを渡す。

/** 書き出し時に作る目印フォルダ名(選択フォルダ直下に作る=選択先を散らかさない)。 */
export const BACKUP_DIR_NAME = 'torimi-memory-backup';

/** 引き継ぐユーザーデータのサブディレクトリ(記憶＋設定。api-key は機械固定ゆえ含めない)。 */
const SUBDIRS = ['memory', 'config'] as const;

export interface BackupResult {
  /** 書き出し先 / 復元先の実パス。 */
  path: string;
  /** 実際にコピーしたサブディレクトリ名。 */
  dirs: string[];
}

/** userDataDir の記憶＋設定を destRoot/torimi-memory-backup/ へ書き出す。 */
export async function exportUserData(userDataDir: string, destRoot: string): Promise<BackupResult> {
  const dest = join(destRoot, BACKUP_DIR_NAME);
  const copied: string[] = [];
  for (const sub of SUBDIRS) {
    const from = join(userDataDir, sub);
    if (!existsSync(from)) continue;
    await fs.cp(from, join(dest, sub), { recursive: true, force: true });
    copied.push(sub);
  }
  return { path: dest, dirs: copied };
}

/**
 * srcRoot(memory/ や config/ を含むバックアップフォルダ)の記憶＋設定を userDataDir へ復元する。
 * 上書き統合(同名は上書き・src に無いファイルは残す)。反映には再起動が必要(起動時にロードするため)。
 */
export async function importUserData(srcRoot: string, userDataDir: string): Promise<BackupResult> {
  const restored: string[] = [];
  for (const sub of SUBDIRS) {
    const from = join(srcRoot, sub);
    if (!existsSync(from)) continue;
    await fs.cp(from, join(userDataDir, sub), { recursive: true, force: true });
    restored.push(sub);
  }
  return { path: userDataDir, dirs: restored };
}

/** srcRoot が ENE のバックアップらしい(memory/ か config/ を含む)か。 */
export function looksLikeBackup(srcRoot: string): boolean {
  return SUBDIRS.some((sub) => existsSync(join(srcRoot, sub)));
}

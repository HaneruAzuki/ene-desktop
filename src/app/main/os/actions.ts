import { shell } from 'electron';
import { spawn } from 'node:child_process';
import { validateUrl, validatePath } from './validators';
import type { OsCommandResult } from '../../../shared/types/os';

// action ごとの実行関数(設計書 §3.5)。
// シェル経由を避け、Electron shell API と引数固定 spawn のみを使う(CLAUDE §7.2)。

/** メモ帳を引数なしで起動(コマンドラインからファイルを開かれる攻撃を防ぐ)。 */
export async function openNotepad(): Promise<OsCommandResult> {
  try {
    // shell:true は使わない(シェルインジェクション対策)。引数配列は空固定。
    const child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  } catch {
    return { ok: false, reason: 'exec_error' };
  }
}

/** 既定ブラウザで URL を開く(http/https のみ)。 */
export async function openBrowser(target: string): Promise<OsCommandResult> {
  const v = validateUrl(target);
  if (!v.ok) {
    return { ok: false, reason: v.reason };
  }
  try {
    await shell.openExternal(target);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'exec_error' };
  }
}

/** エクスプローラでフォルダを開く(ユーザーホーム配下のみ)。 */
export async function openFolder(target: string): Promise<OsCommandResult> {
  const v = validatePath(target);
  if (!v.ok) {
    return { ok: false, reason: v.reason };
  }
  try {
    const errorMessage = await shell.openPath(target);
    if (errorMessage) {
      return { ok: false, reason: 'exec_error' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'exec_error' };
  }
}

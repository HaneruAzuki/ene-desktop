import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { log } from '../../shared/logger';
import { getUserDataDir, getVoiceEngineExePath } from '../../shared/node/paths';

// 音声エンジンの孤児プロセス対策(N-REL-4)。ライフサイクル本体(voice-engine.ts)から分離。
//
// 課題: Windows では親(Electron)がクラッシュ/強制終了で死んでも、子(run.exe)は自動終了しない
//   (detached:false でも Job Object を使わない限り道連れにならない)。正常終了は before-quit/will-quit で
//   確実に kill するが、異常終了だと run.exe が孤児として 10101 で動き続ける(アプリを閉じても常駐=「痕跡」)。
// 対策: 起動時にロックファイルを書き、正常終了で消す。次回起動でロックが残っていれば前回は異常終了
//   =孤児の可能性 → **自分のエンジン実体パスに一致するプロセスだけ**をツリー強制終了して掃除する。
//   パス一致が肝: ユーザーが別途入れた標準 AivisSpeech(別パスの同名 exe)や PID 再利用を巻き込まない。
// 限界: 「親死=子死」の即時掃除には Windows Job Object が要る(新規依存=§2.4 承認事項のため未導入)。
//   本対策は「次回起動で必ず掃除」=孤児を1セッション分に限定する代替。

/** reconcile の PowerShell 掃除に与える上限(超えたら諦めて起動を続ける・best-effort)。 */
const ORPHAN_RECONCILE_TIMEOUT_MS = 4000;

/** 起動エンジンの孤児検知用ロックの場所(userData 直下・更新やアンインストールを跨いでもよい一時状態)。 */
function engineLockPath(): string {
  return join(getUserDataDir(), '.ene-engine.lock');
}

/** spawn 時にロックを書く(中身は診断＋掃除対象パスの記録)。best-effort。 */
export function writeEngineLock(pid: number | undefined): void {
  try {
    writeFileSync(engineLockPath(), JSON.stringify({ pid: pid ?? null, exePath: getVoiceEngineExePath() }));
  } catch {
    /* best-effort: ロックが書けなくても起動は続ける */
  }
}

/** 正常終了/掃除後にロックを消す。best-effort。 */
export function clearEngineLock(): void {
  try {
    if (existsSync(engineLockPath())) unlinkSync(engineLockPath());
  } catch {
    /* best-effort */
  }
}

/**
 * 前回が異常終了(ロック残存)なら、自分のエンジン実体パスに一致するプロセスをツリー強制終了して掃除する。
 * Windows 専用(他 OS は no-op)。パスは前回ロックの記録を優先(更新でパスが変わっても取りこぼさない)。
 * §7.2 準拠: spawn・shell:false・固定引数。パスはアプリ管理値(ユーザー入力なし)で PowerShell へ単一引用符渡し。
 */
export async function reconcileOrphanedEngine(): Promise<void> {
  const lockPath = engineLockPath();
  if (!existsSync(lockPath)) return; // 前回は正常終了=孤児なし
  let exePath = getVoiceEngineExePath();
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf-8')) as { exePath?: string };
    if (parsed.exePath) exePath = parsed.exePath;
  } catch {
    /* パース失敗=現行パスで掃除 */
  }
  clearEngineLock();
  if (process.platform !== 'win32') return;
  // フルパス一致のプロセスのみツリー強制終了(WMI でパス判定→標準版/無関係 PID を巻き込まない)。
  const ps =
    `Get-CimInstance Win32_Process -Filter "Name='${basename(exePath)}'" | ` +
    `Where-Object { $_.ExecutablePath -eq '${exePath.replace(/'/g, "''")}' } | ` +
    `ForEach-Object { taskkill /PID $_.ProcessId /T /F }`;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      const timer = setTimeout(finish, ORPHAN_RECONCILE_TIMEOUT_MS);
      proc.once('exit', () => {
        clearTimeout(timer);
        log.info('reconciled orphaned voice engine (path-matched cleanup)');
        finish();
      });
      proc.once('error', () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      finish();
    }
  });
}

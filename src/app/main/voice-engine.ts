import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { log } from '../../shared/logger';
import { getVoiceEngineDir, getVoiceEngineExePath } from '../../shared/node/paths';
import {
  VOICE_ENGINE_BASE_URL,
  VOICE_ENGINE_HOST,
  VOICE_ENGINE_PORT,
  VOICE_ENGINE_HEALTH_TIMEOUT_MS,
  VOICE_ENGINE_HEALTH_INTERVAL_MS,
  VOICE_ENGINE_STOP_GRACE_MS,
} from '../../shared/constants';

// AivisSpeech サイドカーのライフサイクル管理(task_17 / N-17-6・N-17-12)。
//
// これは voice-provisioner.ts(純粋な進行ロジック)が委ねる「副作用アダプタ」の実体。
// 起動時に run.exe を spawn(shell:false・固定パス・引数配列=§7.2準拠)→ /version でヘルス確認、
// 終了時に kill(自分が起動した場合のみ・外部起動エンジンは殺さない)。
//
// エンジン本体は配布物(exe)に同梱せず data/voice/engine/ に別配置する(コア<100MB維持・§4.3)。
// 既定モデルと BERT はエンジン自身が初回起動時に取得するため、ここでは「起動して待つ」だけでよい。
//
// 設計方針(疎結合・テスト容易性): 判断ロジック(decideEngineAction)と待機(waitHealthy)を
// 純粋関数として分離し、副作用(spawn/fetch)から切り離して単体テスト対象にする。

/** GET /version 用の最小レスポンス型(DOM/undici のグローバル型に依存しない)。 */
interface MinimalResponse {
  ok: boolean;
  status: number;
}
type FetchLike = (url: string, init?: { method?: string; signal?: unknown }) => Promise<MinimalResponse>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * エンジンの起動アクションを判断する(純粋)。
 * - 既に到達可能(誰かが起動済み/前回の残り)→ skip(spawn しない=ポート衝突回避)
 * - 未到達 & バイナリ有 → spawn
 * - 未到達 & バイナリ無 → absent(Phase 2 ではここで DL)
 */
export function decideEngineAction(reachable: boolean, present: boolean): 'skip' | 'spawn' | 'absent' {
  if (reachable) return 'skip';
  if (present) return 'spawn';
  return 'absent';
}

/**
 * probe が true を返すまでポーリングする(probe は注入=テスト容易)。
 * 即時に1回試し、以後 intervalMs 間隔で timeoutMs まで繰り返す。立たなければ false。
 */
export async function waitHealthy(
  probe: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs: number },
): Promise<boolean> {
  if (await probe()) return true;
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    await sleep(opts.intervalMs);
    if (await probe()) return true;
  }
  return false;
}

/** `GET {baseUrl}/version` が 2xx を返すか(liveness)。接続拒否・タイムアウトは false。 */
async function probeVersion(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  const fetchFn = (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (!fetchFn) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${baseUrl}/version`, { method: 'GET', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// --- サイドカープロセスの状態(モジュールスコープ) ---
let engineChild: ChildProcess | null = null;
/** 自分が起動したエンジンか(外部起動を誤って kill しないためのフラグ)。 */
let ownsEngine = false;
/** 終了処理が走ったか。背景起動(ensureVoiceEngine)中の quit で spawn が遅れて孤児になるのを防ぐ。 */
let stopping = false;

export type EnsureEngineResult = 'running' | 'started' | 'absent' | 'failed';

/**
 * 音声エンジンを起動可能状態にする(best-effort・起動はブロックしない)。
 * - running: 既に立っていた(外部 or 残存)。kill しない。
 * - started: 今回 spawn して健全化した。
 * - absent : バイナリ未配置(テキストのみで続行・要 setup:voice-engine)。
 * - failed : spawn したが時間内に健全化せず(後から立てば喋れる)。
 */
export async function ensureVoiceEngine(): Promise<EnsureEngineResult> {
  const baseUrl = VOICE_ENGINE_BASE_URL;
  const exePath = getVoiceEngineExePath();
  const reachable = await probeVersion(baseUrl);
  const present = existsSync(exePath);
  const action = decideEngineAction(reachable, present);

  if (action === 'skip') {
    ownsEngine = false;
    log.info('voice engine already running; reusing existing process');
    return 'running';
  }
  if (action === 'absent') {
    log.warn(
      `voice engine not found at ${exePath}; voice disabled (text only). run "npm run setup:voice-engine"`,
    );
    return 'absent';
  }

  // 背景起動中に終了処理が走っていたら spawn しない(孤児プロセス防止)。
  if (stopping) return 'failed';

  // spawn(shell:false・固定パス・引数配列・コンソール窓を出さない)。
  try {
    const child = spawn(
      exePath,
      ['--host', VOICE_ENGINE_HOST, '--port', String(VOICE_ENGINE_PORT)],
      { cwd: getVoiceEngineDir(), shell: false, windowsHide: true, stdio: 'ignore', detached: false },
    );
    engineChild = child;
    ownsEngine = true;
    // spawn 直後に終了処理が走っていたら即停止(spawn と stop の競合を解消)。
    if (stopping) {
      await stopVoiceEngine();
      return 'failed';
    }
    child.on('exit', (code) => {
      log.info(`voice engine exited (code ${code ?? 'null'})`);
      if (engineChild === child) {
        engineChild = null;
        ownsEngine = false;
      }
    });
    child.on('error', (e) => {
      log.warn('voice engine process error', { name: (e as Error).name });
    });

    log.info('voice engine spawned; waiting for health');
    const healthy = await waitHealthy(() => probeVersion(baseUrl), {
      timeoutMs: VOICE_ENGINE_HEALTH_TIMEOUT_MS,
      intervalMs: VOICE_ENGINE_HEALTH_INTERVAL_MS,
    });
    if (healthy) {
      log.info('voice engine started (healthy)');
      return 'started';
    }
    log.warn('voice engine did not become healthy in time; continuing (may come online later)');
    return 'failed';
  } catch (e) {
    log.warn('failed to start voice engine', { name: (e as Error).name });
    return 'failed';
  }
}

/**
 * 自分が起動したエンジンを停止する(冪等)。外部起動のエンジンは止めない。
 * child.kill() 後、猶予内に終了しなければ Windows は taskkill でプロセスツリーを強制終了する。
 */
export async function stopVoiceEngine(): Promise<void> {
  stopping = true;
  const child = engineChild;
  engineChild = null;
  if (!child || !ownsEngine) {
    ownsEngine = false;
    return;
  }
  ownsEngine = false;
  const pid = child.pid;
  try {
    child.kill();
  } catch {
    /* 既に終了している場合は無視 */
  }
  if (pid === undefined) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(() => {
      // 猶予後もしぶとい場合はツリーごと強制終了(PyInstaller の子プロセスも確実に止める)。
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {
        /* best-effort */
      }
      finish();
    }, VOICE_ENGINE_STOP_GRACE_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      finish();
    });
  });
  log.info('voice engine stopped');
}

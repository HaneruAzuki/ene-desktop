import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { log } from '../../shared/logger';
import {
  getVoiceEngineDir,
  getVoiceEngineExePath,
  getActiveCharacterId,
} from '../../shared/node/paths';
import {
  VOICE_ENGINE_BASE_URL,
  VOICE_ENGINE_HOST,
  VOICE_ENGINE_PORT,
  VOICE_ENGINE_HEALTH_TIMEOUT_MS,
  VOICE_ENGINE_HEALTH_INTERVAL_MS,
  VOICE_ENGINE_STOP_GRACE_MS,
} from '../../shared/constants';
import { loadVoiceConfig } from '../../voice/voice-loader';
import { prepareEngineUserData, engineOfflineEnv } from '../../shared/node/engine-userdata';
import { writeEngineLock, clearEngineLock, reconcileOrphanedEngine } from './voice-engine-orphan';

// AivisSpeech サイドカーのライフサイクル管理(task_17 / N-17-6・N-17-12・N-17-13)。
//
// これは voice-provisioner.ts(純粋な進行ロジック)が委ねる「副作用アダプタ」の実体。
// 起動時に run.exe を spawn(shell:false・固定パス・引数配列=§7.2準拠)→ /version でヘルス確認、
// 終了時に kill(自分が起動した場合のみ・外部起動エンジンは殺さない)。
//
// エンジン本体は配布物(exe)に同梱せず data/voice/engine/ に別配置する(コア<100MB維持・§4.3)。
//
// ポータブル化＋完全オフライン化(N-17-13・実機 spike 検証済):
//  - spawn 前に engine-userdata で %APPDATA%\AivisSpeech-Engine を data/voice/userdata へ「一時借用」
//    (ジャンクション/共存時はハードリンク)。終了時に外す=正常終了で %APPDATA% に痕跡ゼロ。
//  - spawn に `--disable_sentry`＋死んだ proxy/offline 環境(engineOfflineEnv)を渡し、エンジンの
//    AivisHub/HuggingFace への外向き通信を端末内で失敗させる(外部送信は Claude のみ=§4.2/§7.1)。
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

  // 前回が異常終了(ロック残存)なら、自分のエンジンの孤児をパス一致で掃除してから進める(標準版/無関係 PID は巻き込まない)。
  // prepareEngineUserData の前に置く=孤児が %APPDATA% のエンジンデータを掴んだまま配置に入らないようにする。
  await reconcileOrphanedEngine();

  // spawn 前に同梱 torimi＋BERT を %APPDATA% のエンジン dir へ直接配置(共存=UUID選択・N-REL-2)。
  // best-effort(prepare 内で握りつぶす)。配置は永続=アンインストール時に installer.nsh が除去する。
  const voiceConfig = await loadVoiceConfig(getActiveCharacterId()).catch(() => null);
  await prepareEngineUserData(voiceConfig?.uuid ?? null);

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
  // `--disable_sentry`＋死んだ proxy/offline 環境で完全オフライン化(N-17-13)。
  try {
    const child = spawn(
      exePath,
      ['--host', VOICE_ENGINE_HOST, '--port', String(VOICE_ENGINE_PORT), '--disable_sentry'],
      {
        cwd: getVoiceEngineDir(),
        env: engineOfflineEnv(),
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
        detached: false,
      },
    );
    engineChild = child;
    ownsEngine = true;
    writeEngineLock(child.pid); // クラッシュ時にこのロックが残り、次回起動の reconcile が孤児を掃除する
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
        clearEngineLock(); // 自分が起動したエンジンが自然終了=孤児なし
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
 * データ配置(torimi＋BERT)は永続なので終了時クリーンアップは無い(除去はアンインストール時・N-REL-2)。
 */
export async function stopVoiceEngine(): Promise<void> {
  stopping = true;
  const child = engineChild;
  engineChild = null;
  if (child && ownsEngine) {
    ownsEngine = false;
    await killEngineProcess(child);
  } else {
    ownsEngine = false;
  }
  clearEngineLock(); // 正常終了=孤児なし(次回起動で reconcile を走らせない)
}

/**
 * 自分が起動したエンジンプロセスを停止する(kill→猶予内に終了しなければ taskkill でツリー強制終了)。
 * PyInstaller の子プロセスも確実に止める。
 */
async function killEngineProcess(child: ChildProcess): Promise<void> {
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

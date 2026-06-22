import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { log } from '../../shared/logger';
import { getModelsDir } from '../../shared/node/paths';
import {
  transcribe as transcribeInProcess,
  warmStt as warmInProcess,
  sttModelDir,
} from '../../voice/stt-transcriber';

// 重い STT を utilityProcess へ逃がす経路(N-REL-5)。既定 off(ENE_STT_WORKER=1 で有効化)。
// 目的: STT 推論(~1.8s + transformers の JS 前後処理)を main から隔離し、発話直後の UI もっさり/
//   「応答なし」を防ぐ。STT 自体は速くならない(同じモデル/CPU)が、main が空く=体感が滑らかになる。
// 安全策(肝): worker の fork/init/応答が失敗・タイムアウトしたら **必ず in-process にフォールバック**する。
//   =worker が動かなくても音声は従来どおり成立(実機未検証の経路を有効化しても退行しないための上限保証)。

const STT_WORKER_ENV = 'ENE_STT_WORKER';
const WORKER_ENABLED = process.env[STT_WORKER_ENV] === '1';
const TRANSCRIBE_TIMEOUT_MS = 30_000; // STT は最長でも数秒。超えたら worker 不調=フォールバック。
const INIT_TIMEOUT_MS = 60_000; // モデルロード込みの fork+init/ウォーム上限。

type WorkerResult = { text?: string; error?: string };

let child: UtilityProcess | null = null;
let readyPromise: Promise<boolean> | null = null; // fork+init が成功したか(false=以後フォールバック)
let nextId = 1;
const pending = new Map<number, { resolve: (r: WorkerResult) => void; timer: ReturnType<typeof setTimeout> }>();

/** 進行中の全要求をフォールバックへ落とす(worker 終了/kill 時)。 */
function failAllPending(reason: string): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ error: reason });
  }
  pending.clear();
}

/** worker を fork し init→ready まで待つ。立たなければ false(=フォールバック)。一度だけ実行。 */
function spawnWorker(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      // 本体(out/main/index.js)と同じディレクトリの out/main/stt-worker.js。main は CJS=__dirname 可。
      const proc = utilityProcess.fork(join(__dirname, 'stt-worker.js'));
      proc.on('message', (msg: unknown) => {
        const m = msg as { type?: string; id?: number; text?: string; error?: string };
        if (m.type === 'ready') {
          child = proc;
          settle(true);
        } else if (m.type === 'result' && typeof m.id === 'number') {
          const p = pending.get(m.id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(m.id);
            p.resolve({ text: m.text, error: m.error });
          }
        }
      });
      proc.on('exit', () => {
        child = null;
        readyPromise = null;
        failAllPending('worker exit');
        settle(false);
      });
      proc.postMessage({ type: 'init', modelsDir: getModelsDir(), modelDir: sttModelDir() });
      setTimeout(() => settle(false), INIT_TIMEOUT_MS);
    } catch (e) {
      log.warn(`stt worker fork failed: ${(e as Error).name}`);
      settle(false);
    }
  });
}

async function ensureWorker(): Promise<boolean> {
  if (!WORKER_ENABLED) return false;
  if (!readyPromise) readyPromise = spawnWorker();
  return readyPromise;
}

/** STT を worker 経由で実行(失敗・タイムアウトは in-process フォールバック)。VAD/PTT 共通の入口。 */
export async function transcribeViaWorker(samples: Float32Array): Promise<string> {
  const ready = await ensureWorker();
  const proc = child;
  if (!ready || !proc) return transcribeInProcess(samples);
  const id = nextId++;
  const result = await new Promise<WorkerResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: 'timeout' });
    }, TRANSCRIBE_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    proc.postMessage({ type: 'transcribe', id, audio: samples });
  });
  if (result.error) {
    log.warn(`stt worker fell back to in-process (${result.error})`);
    return transcribeInProcess(samples);
  }
  return result.text ?? '';
}

/** 起動ゲート用ウォーム。worker 有効時は worker を温める。立たなければ in-process を温める(フォールバック先)。 */
export async function warmSttWorker(): Promise<void> {
  if (!WORKER_ENABLED) {
    await warmInProcess();
    return;
  }
  const ready = await ensureWorker();
  const proc = child;
  if (!ready || !proc) {
    await warmInProcess(); // worker が立たない → フォールバック先(in-process)を温めておく
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, INIT_TIMEOUT_MS);
    const onMsg = (msg: unknown): void => {
      if ((msg as { type?: string }).type !== 'warmed') return;
      clearTimeout(timer);
      proc.off('message', onMsg);
      resolve();
    };
    proc.on('message', onMsg);
    proc.postMessage({ type: 'warm' });
  });
  log.info('stt worker warmed');
}

/** 終了時に worker を確実に止める(孤児にしない)。 */
export function killSttWorker(): void {
  const proc = child;
  child = null;
  readyPromise = null;
  failAllPending('shutdown');
  if (proc) {
    try {
      proc.kill();
    } catch {
      /* best-effort */
    }
  }
}

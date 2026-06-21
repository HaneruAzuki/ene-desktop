// 診断スパイク(throwaway/手動実行): AivisSpeech エンジンの「%APPDATA% 一時借用＋完全オフライン」を実機検証する。
//
// 前回 spike の結果: (a) 直接配置モデルのロード=OK・複製なし / (b) BERT サブdir junction＋オフライン合成=OK。
// ただし新発見: フレッシュ dir だとエンジンが既定モデル「まお」(a59cb814)を api.aivis-project.com から
// 自動DLする(第3の外部宛先・HF_HUB_OFFLINE では止まらない)。+ AivisHubClient の起動イベント(テレメトリ疑い)。
//
// 本 spike の目的(最後の go/no-go): 子プロセスに **死んだ HTTP_PROXY** を渡してエンジンの全 outbound を
// 端末内で失敗させたとき、(1) 既定モデルDLが端末外に出ず失敗し(=ネットワーク遮断が効く)、
// (2) それでもエンジンが起動し・**オフラインで合成できる**(=既定DL失敗をグレースフルに継続)か、を確認する。
//
// ⚠️ 必ず「普通の PowerShell」から実行(Claude ツール経由は %APPDATA% 仮想化で不可・N-12-3)。
//    実行前に ene アプリと AivisSpeech を閉じること。
//   実行:  node scripts/spike-engine-userdata.mjs

import { promises as fs } from 'node:fs';
import { existsSync, lstatSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPDATA = process.env.APPDATA;
const REAL = join(APPDATA, 'AivisSpeech-Engine');
const BAK = join(APPDATA, 'AivisSpeech-Engine.spikebak');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_DIR = join(REPO, 'data', 'voice', 'engine');
const ENGINE = join(ENGINE_DIR, 'run.exe');
const TEST = 'C:\\tmp\\ene-spike\\userdata';
const PORT = 10134;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isJunction(p) { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } }
async function rmJunction(p) { try { if (existsSync(p)) await fs.rmdir(p); } catch (e) { console.log('  rmdir fail', p, e.code); } }

// 退避 dir 内の torimi(c0d0e43a)を優先、無ければ既定 a59cb814 以外の .aivmx を1つ返す。
// (テストで既定モデル a59cb814 を「不在」にして、エンジンの自動DL挙動を誘発するため)
async function pickModel(modelsDir) {
  const files = await fs.readdir(modelsDir);
  return files.find((f) => /^c0d0e43a.*\.aivmx$/i.test(f))
    ?? files.find((f) => f.endsWith('.aivmx') && !/^a59cb814/i.test(f))
    ?? files.find((f) => f.endsWith('.aivmx'));
}

let renamed = false, apdJ = false, child = null;
try {
  if (!existsSync(ENGINE)) { console.log('run.exe が見つかりません:', ENGINE); process.exit(1); }

  // 自己修復(前回中断の後始末)
  if (isJunction(REAL)) await rmJunction(REAL);
  if (!existsSync(REAL) && existsSync(BAK)) { await fs.rename(BAK, REAL); console.log('recovered: restored REAL from BAK'); }
  if (existsSync(BAK)) { console.log('既に .spikebak があります。手動確認してください:', BAK); process.exit(1); }
  if (existsSync(TEST)) { await rmJunction(join(TEST, 'BertModelCaches')); await fs.rm(TEST, { recursive: true, force: true }).catch(() => {}); }
  if (!existsSync(REAL)) { console.log('AivisSpeech-Engine が存在しません。このスパイクは既存 dir 前提です。'); process.exit(1); }

  await fs.rename(REAL, BAK); renamed = true;
  console.log('STEP1 退避: AivisSpeech-Engine -> .spikebak');

  const modelFile = await pickModel(join(BAK, 'Models'));
  if (!modelFile) throw new Error('退避先に .aivmx が無い');
  await fs.mkdir(join(TEST, 'Models'), { recursive: true });
  await fs.copyFile(join(BAK, 'Models', modelFile), join(TEST, 'Models', modelFile));
  await fs.symlink(join(BAK, 'BertModelCaches'), join(TEST, 'BertModelCaches'), 'junction');
  console.log('STEP2 直接配置:', modelFile, '(既定 a59cb814 は不在=自動DLを誘発) / BERT subdir junction');

  await fs.symlink(TEST, REAL, 'junction'); apdJ = true;
  console.log('STEP3 %APPDATA% junction -> TEST');

  // ★本番想定の env: 死んだ proxy で全 outbound を端末内失敗させる + offline flags
  const childEnv = {
    ...process.env,
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
    http_proxy: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
  };
  const t0 = Date.now();
  const logs = [];
  child = spawn(ENGINE, ['--host', '127.0.0.1', '--port', String(PORT), '--output_log_utf8', '--disable_sentry'],
    { cwd: ENGINE_DIR, env: childEnv, windowsHide: true });
  child.stdout.on('data', (d) => logs.push(d.toString('utf8')));
  child.stderr.on('data', (d) => logs.push(d.toString('utf8')));

  let healthy = false;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + '/version')).ok) { healthy = true; break; } } catch {} await sleep(1000); }
  const tHealthy = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('STEP4 エンジン healthy:', healthy, `(${tHealthy}s)`);

  let styleId = null, synthStatus = 'n/a', synthBytes = 0;
  if (healthy) {
    try { const sp = await (await fetch(BASE + '/speakers')).json(); styleId = sp?.[0]?.styles?.[0]?.id ?? null; } catch (e) { console.log('  speakers err', e.message); }
    if (styleId != null) {
      try {
        const q = await (await fetch(`${BASE}/audio_query?text=${encodeURIComponent('テストだよ')}&speaker=${styleId}`, { method: 'POST' })).json();
        const syn = await fetch(`${BASE}/synthesis?speaker=${styleId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
        synthStatus = syn.status; synthBytes = syn.ok ? (await syn.arrayBuffer()).byteLength : 0;
      } catch (e) { console.log('  synth err', e.message); }
    }
  }

  const log = logs.join('');
  const attempted = /aivis-project\.com|Downloading AIVMX|default model/i.test(log);
  const downloaded = /Downloaded AIVMX file/i.test(log);
  const networkKilled = attempted && !downloaded;     // outbound を試みたが完了しなかった=遮断成功
  const graceful = healthy && synthBytes > 1000;       // 遮断下でも起動＆合成できた

  console.log('\n========== SPIKE 結果(本番ネットワーク遮断構成) ==========');
  console.log(`ネットワーク遮断が効く : ${networkKilled ? 'PASS' : (attempted ? 'FAIL(DL成功=proxy無視)' : '判定不可(DL試行なし)')}`);
  console.log(`遮断下でも起動＆合成   : ${graceful ? 'PASS' : 'FAIL'} (healthy=${healthy}, synth=${synthStatus}/${synthBytes}B, 起動${tHealthy}s)`);
  console.log(`  既定モデルDL試行=${attempted} / DL完了=${downloaded}`);
  console.log('==========================================================\n');
  console.log('--- engine log (filtered) ---');
  console.log(log.split('\n').filter((l) => /director|model|bert|download|install|scan|cache|loaded|offline|aivis-project|attempt|proxy|error|fail/i.test(l)).slice(0, 35).join('\n'));
} catch (e) {
  console.log('SPIKE ERROR:', e.message);
} finally {
  console.log('\n--- teardown ---');
  if (child?.pid) { try { child.kill(); } catch {} await sleep(1000); try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} await sleep(1500); }
  if (apdJ) { await rmJunction(REAL); }
  await rmJunction(join(TEST, 'BertModelCaches')); // rm -rf の前に必ずリンク解除(退避先へ追従させない)
  await fs.rm(TEST, { recursive: true, force: true }).catch((e) => console.log('rm TEST', e.code));
  await fs.rm('C:\\tmp\\ene-spike', { recursive: true, force: true }).catch(() => {});
  if (renamed && !existsSync(REAL) && existsSync(BAK)) { await fs.rename(BAK, REAL); console.log('復元: .spikebak -> AivisSpeech-Engine'); }
  console.log('FINAL: AivisSpeech-Engine 実dir =', existsSync(REAL) && !isJunction(REAL), '| .spikebak 残 =', existsSync(BAK));
}

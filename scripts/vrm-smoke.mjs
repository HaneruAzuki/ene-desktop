// VRM 計測ハーネス(アプリ本体に非干渉の単体 Electron)。
// 小窓・透過・最前面で VRM を読み込み、Electron 各プロセスの CPU%/RAM を毎秒出力する。
// 目的: 成功基準7(常駐 CPU 3% / 配布 100MB)のうち、3D表示の常駐 CPU/RAM を実機検証する。
//
// 使い方:
//   npm run vrm:smoke                       … 既定 characters/model/Torimi.vrm を読み込む
//   ENE_VRM="C:\\path\\to\\foo.vrm" npm run vrm:smoke
//
// 注意: これは計測専用の使い捨て。配布物にもアプリ本体フローにも含めない。
import { app, BrowserWindow } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const vrmPath = process.env.ENE_VRM
  ? resolve(process.env.ENE_VRM)
  : resolve(here, '../characters/model/Torimi.vrm');

if (!existsSync(vrmPath)) {
  console.error(`VRM が見つかりません: ${vrmPath}\nENE_VRM=パス で指定するか characters/model/ に置いてください。`);
  process.exit(1);
}

let win;
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 340,
    height: 480,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    // 計測用ハーネスのみ webSecurity を切る(file:// の ES モジュール/VRM 読込のため)。本体では使わない。
    webPreferences: { webSecurity: false, contextIsolation: true, nodeIntegration: false },
  });

  const html = pathToFileURL(resolve(here, 'vrm-harness.html')).href;
  const vrmUrl = pathToFileURL(vrmPath).href;
  win.loadURL(`${html}?vrm=${encodeURIComponent(vrmUrl)}`);
  // 必要なら DevTools: win.webContents.openDevTools({ mode: 'detach' });

  console.log(`\nVRM: ${vrmPath}`);
  console.log('小窓を操作しながら、下の毎秒ログで CPU/RAM を確認してください(Ctrl+C で終了)。');
  console.log('発話デモ ON / SpringBone ON のときが最も重い条件です。\n');

  let n = 0;
  const timer = setInterval(() => {
    const metrics = app.getAppMetrics();
    let cpu = 0;
    let mem = 0;
    const parts = [];
    for (const m of metrics) {
      const c = m.cpu?.percentCPUUsage ?? 0;
      const ws = (m.memory?.workingSetSize ?? 0) / 1024; // KB -> MB
      cpu += c;
      mem += ws;
      parts.push(`${m.type}:${c.toFixed(1)}%/${ws.toFixed(0)}MB`);
    }
    n += 1;
    console.log(
      `[${String(n).padStart(3, '0')}s] CPU合計 ${cpu.toFixed(1)}% (1コア基準) | RAM合計 ${mem.toFixed(0)}MB | ${parts.join('  ')}`,
    );
  }, 1000);

  win.on('closed', () => {
    clearInterval(timer);
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());

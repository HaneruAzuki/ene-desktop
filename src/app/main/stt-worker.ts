// STT 推論を main から隔離するための utilityProcess エントリ(N-REL-5)。
// main(stt-worker-client)から fork され、parentPort 越しに init/warm/transcribe を受ける。
// 狙い: 重い STT(~1.8s + transformers の JS 前後処理)を別プロセスで回し、main のイベントループを
//   塞がない=発話直後でも UI/クリックがもっさりしない・「応答なし」を防ぐ。
// Electron app には依存しない(utilityProcess に app は無い)。モデル置き場は init で main から絶対パスを受け取る。

import { loadAsrPipeline, runTranscribe, runWarm, type AsrPipeline } from '../../voice/stt-pipeline';

type InMsg =
  | { type: 'init'; modelsDir: string; modelDir: string }
  | { type: 'warm' }
  | { type: 'transcribe'; id: number; audio: Float32Array };

const parentPort = process.parentPort;

let asrPromise: Promise<AsrPipeline> | null = null;
let initArgs: { modelsDir: string; modelDir: string } | null = null;

function post(msg: unknown): void {
  parentPort?.postMessage(msg);
}

async function getAsr(): Promise<AsrPipeline> {
  if (!asrPromise) {
    if (!initArgs) throw new Error('stt worker not initialized');
    asrPromise = loadAsrPipeline(initArgs.modelsDir, initArgs.modelDir).then((r) => r.asr);
  }
  try {
    return await asrPromise;
  } catch (e) {
    asrPromise = null; // 一過性のロード失敗を恒久故障にしない(次回 warm/transcribe で再試行)
    throw e;
  }
}

function handle(msg: InMsg): void {
  if (msg.type === 'init') {
    initArgs = { modelsDir: msg.modelsDir, modelDir: msg.modelDir };
    post({ type: 'ready' });
    return;
  }
  if (msg.type === 'warm') {
    void getAsr()
      .then((asr) => runWarm(asr))
      .then(() => post({ type: 'warmed' }))
      .catch((err: unknown) => post({ type: 'warmed', error: (err as Error).name }));
    return;
  }
  // transcribe: 失敗(ロード/推論)は error 付きで返し、client 側が in-process フォールバックする。
  const audio = msg.audio instanceof Float32Array ? msg.audio : new Float32Array(msg.audio);
  void getAsr()
    .then((asr) => runTranscribe(asr, audio))
    .then((text) => post({ type: 'result', id: msg.id, text }))
    .catch((err: unknown) => post({ type: 'result', id: msg.id, error: (err as Error).name }));
}

if (parentPort) {
  parentPort.on('message', (e: Electron.MessageEvent) => handle(e.data as InMsg));
}

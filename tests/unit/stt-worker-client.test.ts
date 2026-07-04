import { describe, it, expect, vi, beforeEach } from 'vitest';

// electron は vitest(node)に無いのでスタブ。utilityProcess は flag off では使われない。
// app は paths.ts が import するだけ(flag off では getModelsDir を呼ばない)。
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: (): string => process.cwd() },
  utilityProcess: { fork: vi.fn() },
}));

// in-process フォールバック先をモック(実モデルをロードしない)。
const inProcess = vi.fn(async (s: Float32Array) => `in-process:${s.length}`);
vi.mock('../../src/voice/stt/stt-transcriber', () => ({
  transcribe: (s: Float32Array) => inProcess(s),
  warmStt: vi.fn(async () => undefined),
  sttModelDir: (): string => 'm',
}));

// N-REL-5: 既定 off(ENE_STT_WORKER 未設定)では worker を fork せず in-process に委譲する=退行しない上限保証。
describe('stt-worker-client (既定 off=フォールバック)', () => {
  beforeEach(() => {
    delete process.env['ENE_STT_WORKER'];
    inProcess.mockClear();
  });

  it('ENE_STT_WORKER 未設定なら worker を起こさず in-process transcribe に委譲する', async () => {
    const { transcribeViaWorker } = await import('../../src/app/main/voice/stt-worker-client');
    const out = await transcribeViaWorker(new Float32Array(8));
    expect(out).toBe('in-process:8');
    expect(inProcess).toHaveBeenCalledTimes(1);
  });
});

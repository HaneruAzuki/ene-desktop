import { describe, it, expect, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { VadRuntime, type VadModel, type VadRuntimeDeps } from '../../src/app/main/vad-runtime';
import { VAD_FRAME_QUEUE_MAX, VAD_FRAME_SIZE } from '../../src/shared/constants';
import { IPC } from '../../src/shared/ipc-channels';

// VadRuntime のフレーム調停・状態機械を単体検証する(横断監査⑥のキュー化＋DI seam)。
// 実 SileroVad / Whisper / BrowserWindow は使わず、すべてフェイク注入する。

interface Sent {
  ch: string;
  payload: unknown;
}

/** 送信を記録するフェイク BrowserWindow。 */
function fakeWin(): { win: BrowserWindow; sent: Sent[] } {
  const sent: Sent[] = [];
  const win = {
    isDestroyed: () => false,
    webContents: { send: (ch: string, payload: unknown) => sent.push({ ch, payload }) },
  } as unknown as BrowserWindow;
  return { win, sent };
}

/** process に渡ったフレームを記録するフェイク VAD。prob は呼び出し回数で決める。 */
function fakeVad(probOf: (callIndex: number) => number): {
  model: VadModel;
  processed: Float32Array[];
} {
  const processed: Float32Array[] = [];
  const model: VadModel = {
    load: async () => {},
    reset: () => {},
    process: async (frame) => {
      const i = processed.length;
      processed.push(frame);
      return probOf(i);
    },
  };
  return { model, processed };
}

function makeDeps(model: VadModel, over: Partial<VadRuntimeDeps> = {}): VadRuntimeDeps {
  return {
    createVad: () => model,
    transcribe: async () => '',
    isSttModelAvailable: async () => true,
    ...over,
  };
}

/** 値 v を 1 要素に持つフレーム(処理順の識別用)。 */
const frame = (v: number): Float32Array => Float32Array.of(v);

describe('VadRuntime — start ゲート', () => {
  it('STT モデル未配置なら start は false(push-to-talk のまま)', async () => {
    const { win } = fakeWin();
    const { model } = fakeVad(() => 0);
    const vad = new VadRuntime(win, undefined, false, undefined, makeDeps(model, {
      isSttModelAvailable: async () => false,
    }));
    expect(await vad.start()).toBe(false);
  });

  it('STT モデルがあれば start は true', async () => {
    const { win } = fakeWin();
    const { model } = fakeVad(() => 0);
    const vad = new VadRuntime(win, undefined, false, undefined, makeDeps(model));
    expect(await vad.start()).toBe(true);
  });

  it('listenOnly は STT 無しでも start できる', async () => {
    const { win } = fakeWin();
    const { model } = fakeVad(() => 0);
    const vad = new VadRuntime(win, undefined, true, undefined, makeDeps(model, {
      isSttModelAvailable: async () => false,
    }));
    expect(await vad.start()).toBe(true);
  });
});

describe('VadRuntime — フレームキュー(横断監査⑥)', () => {
  it('未開始ならフレームを無視する(process を呼ばない)', async () => {
    const { win } = fakeWin();
    const { model, processed } = fakeVad(() => 0);
    const vad = new VadRuntime(win, undefined, false, undefined, makeDeps(model));
    await vad.pushFrame(frame(1));
    expect(processed).toHaveLength(0);
  });

  it('上限以内のバーストは1つも取りこぼさず順序通り処理する', async () => {
    const { win } = fakeWin();
    const { model, processed } = fakeVad(() => 0); // 無音=セグメンタは何も発火しない
    const vad = new VadRuntime(win, undefined, false, undefined, makeDeps(model));
    await vad.start();
    const n = 10; // < VAD_FRAME_QUEUE_MAX
    await Promise.all(Array.from({ length: n }, (_, i) => vad.pushFrame(frame(i))));
    expect(processed.map((f) => f[0])).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it('持続過負荷では最古を捨ててバックログを有界に保つ(最新フレームは残る)', async () => {
    const { win } = fakeWin();
    const { model, processed } = fakeVad(() => 0);
    const vad = new VadRuntime(win, undefined, false, undefined, makeDeps(model));
    await vad.start();
    // 同期バーストで CAP を大きく超えて積む。最初の1枚が処理中=in-flight、残りはキューへ。
    // キューが CAP に達すると最古を捨てるので、処理されるのは「先頭1枚 + 最新 CAP 枚」。
    const total = VAD_FRAME_QUEUE_MAX + 20;
    await Promise.all(Array.from({ length: total }, (_, i) => vad.pushFrame(frame(i))));

    const order = processed.map((f) => f[0]);
    expect(order.length).toBe(VAD_FRAME_QUEUE_MAX + 1); // in-flight 1 + キュー CAP
    expect(order[0]).toBe(0); // 先頭(処理中だった1枚)は残る
    expect(order).toContain(total - 1); // 最新フレームは捨てられない
    expect(order).not.toContain(5); // 中間の最古側は捨てられている
  });

  it('stop でキューを破棄する', async () => {
    const { win } = fakeWin();
    const { model, processed } = fakeVad(() => 0);
    const vad = new VadRuntime(win, undefined, false, undefined, makeDeps(model));
    await vad.start();
    vad.stop();
    await vad.pushFrame(frame(1));
    expect(processed).toHaveLength(0); // stop 後は active=false=無視
  });
});

describe('VadRuntime — 発話→文字起こし', () => {
  it('発話の後に十分な無音が続くと文字起こし結果を renderer へ送る', async () => {
    const { win, sent } = fakeWin();
    // 最初の30フレームは発話(prob 0.9)、以降は無音(0.0)。無音が VAD_MIN_SILENCE_MS を超え終話確定。
    const { model } = fakeVad((i) => (i < 30 ? 0.9 : 0.0));
    const transcribe = vi.fn(async () => 'こんにちは');
    const vad = new VadRuntime(win, undefined, false, undefined, makeDeps(model, { transcribe }));
    await vad.start();
    // 120フレーム ≒ 3.8秒(無音 90フレーム ≒ 2.9秒 > 0.8秒)で確実に終話まで到達させる。
    for (let i = 0; i < 120; i++) await vad.pushFrame(new Float32Array(VAD_FRAME_SIZE));

    expect(transcribe).toHaveBeenCalledTimes(1);
    const transcripts = sent.filter((s) => s.ch === IPC.VOICE_TRANSCRIPT);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.payload).toBe('こんにちは');
    // 発話開始→録音、終話→うなずき、の状態遷移も送られている。
    expect(sent.some((s) => s.ch === IPC.VOICE_STATE && s.payload === 'recording')).toBe(true);
    expect(sent.some((s) => s.ch === IPC.TURN_NOD)).toBe(true);
  });

  it('空認識なら onUnintelligible を呼ぶ(無音で放置しない・聞き返し・STT は1回のみ)', async () => {
    const { win, sent } = fakeWin();
    const { model } = fakeVad((i) => (i < 30 ? 0.9 : 0.0));
    const transcribe = vi.fn(async () => ''); // 空認識
    const onUnintelligible = vi.fn();
    const vad = new VadRuntime(win, undefined, false, undefined, makeDeps(model, { transcribe }));
    vad.onUnintelligible = onUnintelligible;
    await vad.start();
    for (let i = 0; i < 120; i++) await vad.pushFrame(new Float32Array(VAD_FRAME_SIZE));

    expect(transcribe).toHaveBeenCalledTimes(1); // 再試行しない(main を倍ブロックしない)
    expect(onUnintelligible).toHaveBeenCalledTimes(1);
    expect(sent.filter((s) => s.ch === IPC.VOICE_TRANSCRIPT)).toHaveLength(0); // 送らない
  });
});

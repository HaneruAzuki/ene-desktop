import { describe, it, expect } from 'vitest';
import {
  VoiceTurnCoordinator,
  adaptWindow,
  type VoiceTurnDeps,
} from '../../src/main/voice-turn-coordinator';
import type { ConversationResponse } from '../../src/shared/types/conversation';

// 投機生成＋コアレッシングの状態機械(段階①)。generate/commit/emit を注入して純粋に検証する。
// VAD イベント順: onSpeechStart(発話開始) → onSpeechEnd(無音・STT開始) → onProvisionalEnd(STT完了テキスト)。
// **STT は時間がかかる**ので、STT 中に再開(onSpeechStart)しうる。その時は onProvisionalEnd で生成しない。

interface GenCall {
  text: string;
  signal: AbortSignal;
  onFirstAudio: () => void;
  resolve: (r: ConversationResponse) => void;
  reject: (e: unknown) => void;
}

function harness(): {
  deps: VoiceTurnDeps;
  calls: GenCall[];
  commits: { text: string; response: ConversationResponse }[];
  emits: ConversationResponse[];
} {
  const calls: GenCall[] = [];
  const commits: { text: string; response: ConversationResponse }[] = [];
  const emits: ConversationResponse[] = [];
  const deps: VoiceTurnDeps = {
    generate: (text, signal, onFirstAudio) =>
      new Promise<ConversationResponse>((resolve, reject) => {
        calls.push({ text, signal, onFirstAudio, resolve, reject });
      }),
    commit: async (text, response) => {
      commits.push({ text, response });
    },
    emitResponse: (response) => {
      emits.push(response);
    },
  };
  return { deps, calls, commits, emits };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const chat = (message: string): ConversationResponse => ({ type: 'chat', message });

describe('VoiceTurnCoordinator (段階① 投機＋コアレッシング)', () => {
  it('単発: 発話→無音→STT完了で生成→第一声→完了で emit＋commit', async () => {
    const { deps, calls, commits, emits } = harness();
    const c = new VoiceTurnCoordinator(deps);
    c.onSpeechStart();
    c.onSpeechEnd();
    c.onProvisionalEnd('こんにちは'); // userSpeaking=false → 生成
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe('こんにちは');
    calls[0].onFirstAudio();
    const resp = chat('やあ');
    calls[0].resolve(resp);
    await flush();
    expect(emits).toEqual([resp]);
    expect(commits).toEqual([{ text: 'こんにちは', response: resp }]);
  });

  it('STT 中に再開していたら生成せず溜める→次の区切りで連結生成(今回の不具合の回帰)', () => {
    const { deps, calls } = harness();
    const c = new VoiceTurnCoordinator(deps);
    // 断片1: 話す→無音(STT開始)
    c.onSpeechStart();
    c.onSpeechEnd();
    // STT 中にユーザが再開
    c.onSpeechStart();
    c.onProvisionalEnd('えっと'); // STT1完了だが userSpeaking=true → 生成しない
    expect(calls).toHaveLength(0);
    // 断片2: 話し終えて無音
    c.onSpeechEnd();
    c.onProvisionalEnd('今日はね'); // userSpeaking=false → 連結して生成
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe('えっと 今日はね');
  });

  it('第一声前の再開は未コミット生成を静かに中断し、次の区切りで連結する', async () => {
    const { deps, calls, commits } = harness();
    const c = new VoiceTurnCoordinator(deps);
    c.onSpeechStart();
    c.onSpeechEnd();
    c.onProvisionalEnd('えっと'); // gen1
    expect(calls[0].text).toBe('えっと');
    c.onSpeechStart(); // 第一声前に再開 → 中断
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].reject(new Error('aborted'));
    await flush();
    expect(commits).toEqual([]);
    c.onSpeechEnd();
    c.onProvisionalEnd('今日はね'); // 連結して再生成
    expect(calls).toHaveLength(2);
    expect(calls[1].text).toBe('えっと 今日はね');
    calls[1].onFirstAudio();
    const resp = chat('うん');
    calls[1].resolve(resp);
    await flush();
    expect(commits).toEqual([{ text: 'えっと 今日はね', response: resp }]);
  });

  it('陳腐化した生成が後から resolve しても破棄される', async () => {
    const { deps, calls, commits, emits } = harness();
    const c = new VoiceTurnCoordinator(deps);
    c.onProvisionalEnd('A'); // gen1
    c.onProvisionalEnd('B'); // gen1 中断 → gen2
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].text).toBe('A B');
    calls[0].resolve(chat('stale'));
    await flush();
    expect(emits).toEqual([]);
    expect(commits).toEqual([]);
  });

  it('コミット後(第一声後)の再開は中断しない(barge-in に委ねる)', () => {
    const { deps, calls } = harness();
    const c = new VoiceTurnCoordinator(deps);
    c.onProvisionalEnd('done');
    calls[0].onFirstAudio(); // committed
    c.onSpeechStart();
    expect(calls[0].signal.aborted).toBe(false);
  });

  it('第一声後は pending がクリアされ、次の区切りは新ターン(連結しない)', async () => {
    const { deps, calls } = harness();
    const c = new VoiceTurnCoordinator(deps);
    c.onProvisionalEnd('A');
    calls[0].onFirstAudio(); // committed → pending クリア
    calls[0].resolve(chat('x'));
    await flush();
    c.onSpeechEnd();
    c.onProvisionalEnd('B');
    expect(calls[1].text).toBe('B'); // 'A B' でなく 'B'
  });

  it('reset で進行中を中断し pending/発話中フラグを空にする', () => {
    const { deps, calls } = harness();
    const c = new VoiceTurnCoordinator(deps);
    c.onProvisionalEnd('x');
    c.reset();
    expect(calls[0].signal.aborted).toBe(true);
    c.onProvisionalEnd('y');
    expect(calls[1].text).toBe('y'); // 連結されない(pending クリア済み)
  });

  it('空文字の暫定終了は無視する', () => {
    const { deps, calls } = harness();
    const c = new VoiceTurnCoordinator(deps);
    c.onProvisionalEnd('   ');
    expect(calls).toHaveLength(0);
  });

  it('適応(段階②): キャンセルのあったターンは窓を広げ、無いターンは縮める', async () => {
    const { deps, calls } = harness();
    const windows: number[] = [];
    deps.setSilenceWindow = (ms) => windows.push(ms);
    const c = new VoiceTurnCoordinator(deps);

    // ターン1: 第一声前に1回再開(=サイレントキャンセル)してから連結・コミット
    c.onSpeechStart();
    c.onSpeechEnd();
    c.onProvisionalEnd('A'); // gen0
    c.onSpeechStart(); // 第一声前に再開 → サイレントキャンセル+1
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].reject(new Error('aborted'));
    await flush();
    c.onSpeechEnd();
    c.onProvisionalEnd('B'); // gen1 = 'A B'
    calls[1].onFirstAudio();
    calls[1].resolve(chat('x'));
    await flush();
    const w1 = windows[windows.length - 1];
    expect(w1).toBeGreaterThan(450); // キャンセルで広がった

    // ターン2: キャンセルなしのクリーンなターン → 窓が縮む
    c.onSpeechStart();
    c.onSpeechEnd();
    c.onProvisionalEnd('C'); // gen2
    calls[2].onFirstAudio();
    calls[2].resolve(chat('y'));
    await flush();
    const w2 = windows[windows.length - 1];
    expect(w2).toBeLessThan(w1);
  });
});

describe('adaptWindow (段階② 無音窓の適応・純粋)', () => {
  it('キャンセル皆無なら基準(450ms)', () => {
    expect(adaptWindow(0, 0)).toEqual({ ema: 0, windowMs: 450 });
  });

  it('キャンセルが増えると窓が広がる', () => {
    const r = adaptWindow(0, 2); // ema=0.6 → 450+250*0.6=600
    expect(r.ema).toBeCloseTo(0.6, 5);
    expect(r.windowMs).toBe(600);
  });

  it('上限 1200ms でクランプ(キャンセル多発)', () => {
    let ema = 0;
    for (let i = 0; i < 30; i++) ema = adaptWindow(ema, 5).ema;
    expect(adaptWindow(ema, 5).windowMs).toBe(1200);
  });

  it('クリーンなターンが続くと基準へ縮む', () => {
    let ema = 3; // 高い状態から
    for (let i = 0; i < 30; i++) ema = adaptWindow(ema, 0).ema;
    expect(adaptWindow(ema, 0).windowMs).toBe(450);
  });
});

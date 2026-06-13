import { describe, it, expect, vi } from 'vitest';
import {
  VoiceTurnCoordinator,
  clampWindow,
  type VoiceTurnDeps,
} from '../../src/app/main/voice-turn-coordinator';
import {
  VAD_PROVISIONAL_SILENCE_MS,
  COALESCE_WINDOW_MIN_MS,
  COALESCE_WINDOW_MAX_MS,
  LISTENING_WINDOW_MS,
  LISTENING_ENTER_SILENT_CANCELS,
  LISTENING_MAX_CHARS,
  LISTENING_YAWN_MS,
} from '../../src/shared/constants';
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

  it('barge-in(生成中): 中断して「ユーザ＋聞かせた分」をコミットし、全文はコミットしない(Phase B)', async () => {
    const { deps, calls, commits } = harness();
    const c = new VoiceTurnCoordinator(deps);
    c.onProvisionalEnd('質問'); // gen0
    calls[0].onFirstAudio(); // committed=トリミ発話中
    c.onBargeIn('えっとね、'); // 聞かせた分だけ
    expect(calls[0].signal.aborted).toBe(true); // これ以上喋らせない
    await flush();
    expect(commits).toEqual([{ text: '質問', response: { type: 'chat', message: 'えっとね、' } }]);
    // 後から gen が resolve しても通常コミットしない(bargedIn)。
    calls[0].resolve(chat('えっとね、続きの全文'));
    await flush();
    expect(commits).toHaveLength(1);
  });

  it('barge-in(生成完了後): 最新 assistant を聞かせた分へ上書きする(Phase B)', async () => {
    const { deps, calls, commits } = harness();
    const updates: string[] = [];
    deps.updateLastAssistant = (t) => updates.push(t);
    const c = new VoiceTurnCoordinator(deps);
    c.onProvisionalEnd('質問');
    calls[0].onFirstAudio();
    calls[0].resolve(chat('文0文1文2の全文')); // 完了 → 全文コミット
    await flush();
    expect(commits).toHaveLength(1);
    c.onBargeIn('文0文1'); // 再生途中で割り込み(gen は完了済み=null)
    expect(updates).toEqual(['文0文1']); // 聞かせた分へ上書き
  });

  it('第一声前(未コミット)の onBargeIn は何もしない', () => {
    const { deps, calls, commits } = harness();
    const updates: string[] = [];
    deps.updateLastAssistant = (t) => updates.push(t);
    const c = new VoiceTurnCoordinator(deps);
    c.onProvisionalEnd('質問'); // gen0・未コミット
    c.onBargeIn('x');
    expect(calls[0].signal.aborted).toBe(false);
    expect(commits).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('案①(段階②): サイレントキャンセルで窓を短く、早い barge-in で長く、遅い barge-in は中立', () => {
    const { deps, calls } = harness();
    const windows: number[] = [];
    deps.setSilenceWindow = (ms) => windows.push(ms);
    const c = new VoiceTurnCoordinator(deps);

    // サイレントキャンセル(第一声前の再開)→ 窓を短く(初期 VAD_PROVISIONAL_SILENCE_MS から STEP_DOWN 縮む)
    c.onProvisionalEnd('A'); // gen0
    c.onSpeechStart(); // 第一声前に再開 = サイレントキャンセル
    expect(calls[0].signal.aborted).toBe(true);
    const afterCancel = windows[windows.length - 1];
    expect(afterCancel).toBeLessThan(VAD_PROVISIONAL_SILENCE_MS);

    // 早い barge-in → 窓を長く(STEP_UP は大きいので afterCancel より上)
    c.onBargeInTiming(true);
    const afterEarly = windows[windows.length - 1];
    expect(afterEarly).toBeGreaterThan(afterCancel);

    // 遅い barge-in → 変化なし(setSilenceWindow を呼ばない)
    const n = windows.length;
    c.onBargeInTiming(false);
    expect(windows.length).toBe(n);
  });
});

describe('clampWindow (案① 無音窓のクランプ・純粋)', () => {
  it('下限 COALESCE_WINDOW_MIN_MS / 上限 COALESCE_WINDOW_MAX_MS でクランプ', () => {
    expect(clampWindow(100)).toBe(COALESCE_WINDOW_MIN_MS);
    expect(clampWindow(2000)).toBe(COALESCE_WINDOW_MAX_MS);
  });
  it('範囲内はそのまま(丸め)', () => {
    // 範囲内の代表値(下限+上限の中点付近)と小数の丸めを確認する。
    const mid = Math.round((COALESCE_WINDOW_MIN_MS + COALESCE_WINDOW_MAX_MS) / 2);
    expect(clampWindow(mid)).toBe(mid);
    expect(clampWindow(mid + 0.4)).toBe(mid);
  });
});

// 傾聴モード(docs/listening-mode-design.md)。窓の差し替え=排他 / 行動入室 / 入力上限 / あくび。
function listeningHarness(opts?: { now?: () => number; listeningEnabled?: boolean }): {
  deps: VoiceTurnDeps;
  calls: GenCall[];
  windows: number[];
  listeningChanges: boolean[];
  yawns: { n: number };
} {
  const calls: GenCall[] = [];
  const windows: number[] = [];
  const listeningChanges: boolean[] = [];
  const yawns = { n: 0 };
  const deps: VoiceTurnDeps = {
    generate: (text, signal, onFirstAudio) =>
      new Promise<ConversationResponse>((resolve, reject) => {
        calls.push({ text, signal, onFirstAudio, resolve, reject });
      }),
    commit: async () => {},
    emitResponse: () => {},
    setSilenceWindow: (ms) => windows.push(ms),
    onListeningChange: (on) => listeningChanges.push(on),
    onYawn: () => {
      yawns.n += 1;
    },
    now: opts?.now,
    listeningEnabled: opts?.listeningEnabled,
  };
  return { deps, calls, windows, listeningChanges, yawns };
}

/** 連続サイレントキャンセルを n 回起こす(各回: 暫定終了で生成→第一声前に再開で中断)。 */
function silentCancel(c: VoiceTurnCoordinator, text: string): void {
  c.onSpeechEnd();
  c.onProvisionalEnd(text); // userSpeaking=false → 生成開始(未コミット)
  c.onSpeechStart(); // 第一声前に再開 → サイレントキャンセル
}

describe('VoiceTurnCoordinator 傾聴モード', () => {
  it('行動入室: 連続サイレントキャンセル2回で傾聴へ(窓を固定値へ差し替え+通知)', () => {
    const { deps, windows, listeningChanges } = listeningHarness();
    const c = new VoiceTurnCoordinator(deps);
    silentCancel(c, 'A'); // 1回目
    expect(listeningChanges).toEqual([]); // まだ入らない
    silentCancel(c, 'B'); // 2回目 → 入室
    expect(LISTENING_ENTER_SILENT_CANCELS).toBe(2);
    expect(listeningChanges).toEqual([true]);
    expect(windows[windows.length - 1]).toBe(LISTENING_WINDOW_MS);
  });

  it('サイレントキャンセル1回では入らない(窓は適応のまま短縮)', () => {
    const { deps, windows, listeningChanges } = listeningHarness();
    const c = new VoiceTurnCoordinator(deps);
    silentCancel(c, 'A');
    expect(listeningChanges).toEqual([]);
    expect(windows[windows.length - 1]).toBeLessThan(VAD_PROVISIONAL_SILENCE_MS);
  });

  it('コミットでカウンタがリセットされ「連続」のみ数える', async () => {
    const { deps, calls, listeningChanges } = listeningHarness();
    const c = new VoiceTurnCoordinator(deps);
    silentCancel(c, 'A'); // cancel#1
    // 間に通常応答が成立(第一声→完了)= 連続が途切れる
    c.onSpeechEnd();
    c.onProvisionalEnd('B');
    const g = calls[calls.length - 1];
    g.onFirstAudio();
    g.resolve(chat('はい'));
    await flush();
    silentCancel(c, 'C'); // これは「1回目」扱い(リセット済み)
    expect(listeningChanges).toEqual([]); // 入らない
  });

  it('requestListening(Claude経路)で即入室', () => {
    const { deps, windows, listeningChanges } = listeningHarness();
    const c = new VoiceTurnCoordinator(deps);
    c.requestListening();
    expect(listeningChanges).toEqual([true]);
    expect(windows[windows.length - 1]).toBe(LISTENING_WINDOW_MS);
  });

  it('傾聴中は適応窓を停止(サイレントキャンセルで縮まない)', () => {
    const { deps, windows } = listeningHarness();
    const c = new VoiceTurnCoordinator(deps);
    c.requestListening(); // window=6000
    silentCancel(c, 'x'); // 傾聴中の中断 → adjustWindow は no-op
    expect(windows[windows.length - 1]).toBe(LISTENING_WINDOW_MS); // 6000 のまま
  });

  it('退室: 第一声で通常窓へ復元+通知', async () => {
    const { deps, calls, windows, listeningChanges } = listeningHarness();
    const c = new VoiceTurnCoordinator(deps);
    c.requestListening(); // windowBeforeListening=500 → 6000
    c.onProvisionalEnd('終わり'); // userSpeaking=false → 生成
    calls[calls.length - 1].onFirstAudio(); // 第一声 → 退室
    expect(listeningChanges).toEqual([true, false]);
    expect(windows[windows.length - 1]).toBe(VAD_PROVISIONAL_SILENCE_MS); // 500 へ復元
  });

  it('入力上限: pendingText が上限超で、発話中でも強制生成して区切る', () => {
    const { deps, calls } = listeningHarness();
    const c = new VoiceTurnCoordinator(deps);
    c.requestListening();
    c.onSpeechStart(); // userSpeaking=true(=普通なら生成しない状況)
    const long = 'あ'.repeat(LISTENING_MAX_CHARS + 1);
    c.onProvisionalEnd(long);
    expect(calls).toHaveLength(1); // 強制生成された
    expect(calls[0].text.length).toBeGreaterThan(LISTENING_MAX_CHARS);
  });

  it('あくび: 経過が閾値超で1回だけ発火(退室でリセット)', async () => {
    let t = 1000;
    const { deps, calls, yawns } = listeningHarness({ now: () => t });
    const c = new VoiceTurnCoordinator(deps);
    c.requestListening(); // listeningStartMs=1000
    c.onSpeechStart(); // userSpeaking=true(生成を起こさず溜めるだけにする)
    t = 1000 + LISTENING_YAWN_MS; // 閾値到達
    c.onProvisionalEnd('まだ続く'); // maybeYawn
    expect(yawns.n).toBe(1);
    c.onProvisionalEnd('さらに続く'); // 2回目は出ない
    expect(yawns.n).toBe(1);
    expect(calls).toHaveLength(0); // userSpeaking 中なので通常生成は無し(あくびのみ)
  });

  it('ENE_LISTENING 無効化(listeningEnabled=false)では行動入室しない', () => {
    const { deps, listeningChanges } = listeningHarness({ listeningEnabled: false });
    const c = new VoiceTurnCoordinator(deps);
    silentCancel(c, 'A');
    silentCancel(c, 'B');
    silentCancel(c, 'C');
    expect(listeningChanges).toEqual([]);
  });

  it('アイドルタイムアウト: 一定時間 発話が無ければ自動退室(姿勢の固着回避)', () => {
    vi.useFakeTimers();
    try {
      const { deps, listeningChanges } = listeningHarness();
      const c = new VoiceTurnCoordinator(deps);
      c.requestListening(); // 入室＋アイドルタイマ起動
      expect(listeningChanges).toEqual([true]);
      vi.advanceTimersByTime(25_000); // 発話が無いまま放置(LISTENING_IDLE_TIMEOUT_MS 超)
      expect(listeningChanges).toEqual([true, false]); // 自動退室
    } finally {
      vi.useRealTimers();
    }
  });
});

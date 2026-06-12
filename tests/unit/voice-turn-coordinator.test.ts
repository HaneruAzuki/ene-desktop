import { describe, it, expect } from 'vitest';
import {
  VoiceTurnCoordinator,
  clampWindow,
  type VoiceTurnDeps,
} from '../../src/main/voice-turn-coordinator';
import {
  VAD_PROVISIONAL_SILENCE_MS,
  COALESCE_WINDOW_MIN_MS,
  COALESCE_WINDOW_MAX_MS,
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

import { describe, it, expect } from 'vitest';
import { decideEngineAction, waitHealthy } from '../../src/main/voice-engine';

// 副作用(spawn/fetch)を持たない純粋ロジックのみ検証する(N-17-12)。
// 起動判断(decideEngineAction)とヘルス待機(waitHealthy・probe 注入)を対象にする。

describe('decideEngineAction (N-17-12)', () => {
  it('既に到達可能なら skip(spawn しない=ポート衝突回避)', () => {
    expect(decideEngineAction(true, true)).toBe('skip');
    expect(decideEngineAction(true, false)).toBe('skip');
  });

  it('未到達でバイナリが有れば spawn', () => {
    expect(decideEngineAction(false, true)).toBe('spawn');
  });

  it('未到達でバイナリが無ければ absent', () => {
    expect(decideEngineAction(false, false)).toBe('absent');
  });
});

describe('waitHealthy (N-17-12)', () => {
  it('probe が即 true ならすぐ解決する', async () => {
    let calls = 0;
    const probe = async (): Promise<boolean> => {
      calls += 1;
      return true;
    };
    expect(await waitHealthy(probe, { timeoutMs: 1000, intervalMs: 5 })).toBe(true);
    expect(calls).toBe(1); // 即時1回で成功(ループに入らない)
  });

  it('数回 false の後 true になれば解決する', async () => {
    let calls = 0;
    const probe = async (): Promise<boolean> => {
      calls += 1;
      return calls >= 3; // 3回目で立ち上がる
    };
    expect(await waitHealthy(probe, { timeoutMs: 1000, intervalMs: 5 })).toBe(true);
    expect(calls).toBe(3);
  });

  it('一度も立たなければ timeout で false', async () => {
    const probe = async (): Promise<boolean> => false;
    expect(await waitHealthy(probe, { timeoutMs: 30, intervalMs: 5 })).toBe(false);
  });
});

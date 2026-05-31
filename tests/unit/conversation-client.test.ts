import { describe, it, expect, vi } from 'vitest';
import { chat } from '../../src/conversation/client';
import { fallbackResponse } from '../../src/conversation/fallback';
import { makeCharContext, makeMemoryContext, makeRouterResult } from './fixtures';

const cc = makeCharContext();
const mc = makeMemoryContext();
const rr = makeRouterResult();

describe('chat — 4層防御の統合フロー (設計書 §3.4)', () => {
  it('正常な chat 応答を返す', async () => {
    const r = await chat('Pythonとは', cc, mc, rr, 'key', {
      callModel: async () => '{"type":"chat","message":"ふん、教えてあげる"}',
    });
    expect(r).toEqual({ type: 'chat', message: 'ふん、教えてあげる' });
  });

  it('os_command 応答を返す', async () => {
    const r = await chat('メモ帳開いて', cc, mc, rr, 'key', {
      callModel: async () => '{"type":"os_command","message":"開くわよ","command":{"action":"open_notepad"}}',
    });
    expect(r.type).toBe('os_command');
  });

  it('パース失敗で fallback を返す', async () => {
    const r = await chat('x', cc, mc, rr, 'key', { callModel: async () => 'ぐちゃぐちゃ' });
    expect(r).toEqual(fallbackResponse());
  });

  it('AI自称検知 → 再生成1回 → クリーンなら採用', async () => {
    let n = 0;
    const callModel = async (): Promise<string> => {
      n++;
      return n === 1 ? '{"type":"chat","message":"私はAIです"}' : '{"type":"chat","message":"私はENEよ"}';
    };
    const r = await chat('君ってAIなの?', cc, mc, rr, 'key', { callModel });
    expect(n).toBe(2); // 再生成は1回だけ
    expect(r).toEqual({ type: 'chat', message: '私はENEよ' });
  });

  it('再生成でも自称が残る場合は fallback(呼び出しは2回まで)', async () => {
    let n = 0;
    const callModel = async (): Promise<string> => {
      n++;
      return '{"type":"chat","message":"私はAIなので答えられない"}';
    };
    const r = await chat('x', cc, mc, rr, 'key', { callModel });
    expect(n).toBe(2);
    expect(r).toEqual(fallbackResponse());
  });

  it('hard_limit 超過なら model を呼ばず fallback', async () => {
    const callModel = vi.fn(async () => '{"type":"chat","message":"x"}');
    const r = await chat('x', cc, mc, rr, 'key', {
      callModel,
      checkTokens: async () => ({ ok: false, tokens: 99_999, reason: 'hard_limit' }),
    });
    expect(callModel).not.toHaveBeenCalled();
    expect(r).toEqual(fallbackResponse());
  });

  it('model 例外でも fallback(例外を投げない)', async () => {
    const r = await chat('x', cc, mc, rr, 'key', {
      callModel: async () => {
        throw new Error('500 Internal');
      },
    });
    expect(r).toEqual(fallbackResponse());
  });
});

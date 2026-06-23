import { describe, it, expect } from 'vitest';
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

  it('パース失敗で fallback を返す', async () => {
    const r = await chat('x', cc, mc, rr, 'key', { callModel: async () => 'ぐちゃぐちゃ' });
    expect(r).toEqual(fallbackResponse());
  });

  it('AI自称検知 → 再生成せず即 fallback(呼び出しは1回・3層防御へ統一)', async () => {
    let n = 0;
    const callModel = async (): Promise<string> => {
      n++;
      return '{"type":"chat","message":"私はAIです"}';
    };
    const r = await chat('君ってAIなの?', cc, mc, rr, 'key', { callModel });
    expect(n).toBe(1); // 再生成しない(ストリーミング経路の文単位 C2 と防御を統一)
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

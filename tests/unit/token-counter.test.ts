import { describe, it, expect } from 'vitest';
import {
  classifyTokenCount,
  estimatePromptTokens,
  countAndCheck,
} from '../../src/conversation/token-counter';

describe('token-counter (要件 NF-PERF-06〜08)', () => {
  it('通常 / warn / hard を判定する', () => {
    expect(classifyTokenCount(1000)).toEqual({ ok: true, tokens: 1000 });
    expect(classifyTokenCount(30_000).reason).toBe('warn');
    expect(classifyTokenCount(30_000).ok).toBe(true);
    expect(classifyTokenCount(60_000)).toEqual({ ok: false, tokens: 60_000, reason: 'hard_limit' });
  });

  it('estimatePromptTokens は system 全ブロック + 全メッセージの文字数から見積もる', () => {
    const t = estimatePromptTokens({
      system: [{ type: 'text', text: 'a'.repeat(25) }],
      messages: [{ role: 'user', content: 'b'.repeat(25) }],
    });
    expect(t).toBe(20); // 50 文字 / 2.5 = 20
  });

  it('複数 system ブロックの文字数を合算する', () => {
    const t = estimatePromptTokens({
      system: [
        { type: 'text', text: 'a'.repeat(25), cacheable: true },
        { type: 'text', text: 'a'.repeat(25) },
      ],
      messages: [],
    });
    expect(t).toBe(20); // 50 文字 / 2.5 = 20
  });

  it('countAndCheck は巨大プロンプトを hard_limit で拒否する', () => {
    const r = countAndCheck({ system: [{ type: 'text', text: 'あ'.repeat(200_000) }], messages: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('hard_limit');
  });

  it('countAndCheck は通常サイズを許可する', () => {
    const r = countAndCheck({
      system: [{ type: 'text', text: 'ふつうの長さ' }],
      messages: [{ role: 'user', content: 'こんにちは' }],
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

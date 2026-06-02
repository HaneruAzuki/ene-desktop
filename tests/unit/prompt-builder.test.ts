import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/conversation/prompt-builder';
import { makeCharContext, makeMemoryContext, makeRouterResult } from './fixtures';

describe('buildPrompt (設計書 §3.4)', () => {
  it('system に neverCallsSelf の語を含む', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'こんにちは');
    expect(p.system).toContain('AI');
    expect(p.system).toContain('アシスタント');
  });

  it('messages の最後は現在の user 入力(Prefill は使わない=現行モデル非対応)', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'こんにちは');
    const last = p.messages[p.messages.length - 1];
    expect(last?.role).toBe('user');
    expect(last?.content).toContain('こんにちは');
  });

  it('few-shot 例と現在の入力が messages に含まれる', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'いまの質問');
    expect(p.messages.some((m) => m.content.includes('ふん、教えてあげるわよ'))).toBe(true);
    expect(p.messages.some((m) => m.role === 'user' && m.content.includes('いまの質問'))).toBe(true);
  });

  it('few-shot/短期記憶の assistant ターンは JSON 形式で提示される(履歴と出力形式の一致)', () => {
    const mc = makeMemoryContext({
      shortTerm: [
        { role: 'user', text: '過去の質問', timestamp: 't1', extracted: true },
        { role: 'assistant', text: '過去の返答', timestamp: 't2', extracted: true },
      ],
    });
    const p = buildPrompt(makeCharContext(), mc, makeRouterResult(), 'x');
    // few-shot の assistant が JSON 化されている
    const fewshotAssistant = p.messages.find((m) => m.content.includes('ふん、教えてあげるわよ'));
    expect(fewshotAssistant?.content).toContain('"type":"chat"');
    // 短期記憶の assistant も JSON 化されている
    const stAssistant = p.messages.find((m) => m.content.includes('過去の返答'));
    expect(stAssistant?.content).toContain('"type":"chat"');
    // user ターンはプレーンのまま
    const stUser = p.messages.find((m) => m.role === 'user' && m.content.includes('過去の質問'));
    expect(stUser?.content).not.toContain('"type":"chat"');
  });

  it('出力形式(os_command 仕様)が system に含まれる', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'x');
    expect(p.system).toContain('os_command');
    expect(p.system).toContain('open_notepad');
    expect(p.system).toContain('open_browser');
    expect(p.system).toContain('open_folder');
  });

  it('routerResult.behavior が system に含まれる', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult({ behavior: '特別な振る舞い' }), 'x');
    expect(p.system).toContain('特別な振る舞い');
  });

  it('連続する同一 role を作らない(交互列を保つ)', () => {
    const mc = makeMemoryContext({
      shortTerm: [{ role: 'user', text: '直前のユーザー発話', timestamp: 't', extracted: false }],
    });
    const p = buildPrompt(makeCharContext(), mc, makeRouterResult(), '新しい質問');
    for (let i = 1; i < p.messages.length; i++) {
      expect(p.messages[i]?.role).not.toBe(p.messages[i - 1]?.role);
    }
    // 先頭は user
    expect(p.messages[0]?.role).toBe('user');
  });

  it('誕生日(today)なら祝福 few-shot を含む', () => {
    const p = buildPrompt(
      makeCharContext({ birthdayHint: 'today' }),
      makeMemoryContext(),
      makeRouterResult(),
      'x',
    );
    expect(p.system).toContain('誕生日');
    expect(p.messages.some((m) => m.content.includes('べ、別に嬉しくない'))).toBe(true);
  });
});

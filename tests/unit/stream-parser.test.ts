import { describe, it, expect } from 'vitest';
import { createVoiceStreamParser } from '../../src/conversation/stream-parser';

// task_17 C1:音声応答のストリーミング書式を逐次解釈する(design-revision-voice §2)。

describe('createVoiceStreamParser', () => {
  it('先頭 emotion を確定し、本文を文単位で返す', () => {
    const p = createVoiceStreamParser();
    expect(p.push('[[emotion:joy]]')).toEqual({ emotion: 'joy', sentences: [] });
    expect(p.push('やあ。元気？')).toEqual({ sentences: ['やあ。', '元気？'] });
    expect(p.flush()).toEqual({ sentences: [] });
  });

  it('emotion sentinel がチャンクを跨いでも解決できる', () => {
    const p = createVoiceStreamParser();
    expect(p.push('[[emo')).toEqual({ sentences: [] });
    expect(p.push('tion:anger]]ふん。')).toEqual({ emotion: 'anger', sentences: ['ふん。'] });
  });

  it('emotion sentinel が無ければ emotion 無しで本文を流す', () => {
    const p = createVoiceStreamParser();
    expect(p.push('こんにちは。')).toEqual({ emotion: undefined, sentences: ['こんにちは。'] });
  });

  it('許可外の emotion ラベルは undefined にフォールバックする', () => {
    const p = createVoiceStreamParser();
    expect(p.push('[[emotion:bogus]]あ。')).toEqual({ emotion: undefined, sentences: ['あ。'] });
  });

  it('flush で未完の最終文(文末記号なし)を出す', () => {
    const p = createVoiceStreamParser();
    p.push('[[emotion:neutral]]最後の文');
    expect(p.flush()).toEqual({ sentences: ['最後の文'] });
  });

  it('末尾 os_command を本文と分離し、喋り終わり後に解析する', () => {
    const p = createVoiceStreamParser();
    const chunk = p.push(
      '[[emotion:neutral]]開くね。[[os_command:{"action":"open_browser","target":"https://example.com"}]]',
    );
    expect(chunk).toEqual({ emotion: 'neutral', sentences: ['開くね。'] });
    expect(p.flush()).toEqual({
      sentences: [],
      command: { action: 'open_browser', target: 'https://example.com' },
    });
  });

  it('部分的な os_command sentinel は発話せず保留する', () => {
    const p = createVoiceStreamParser();
    // "[[os_comm" は CMD_OPEN の途中。本文として喋ってはいけない。
    expect(p.push('終わり。[[os_comm')).toEqual({ emotion: undefined, sentences: ['終わり。'] });
    p.push('and:{"action":"open_notepad"}]]');
    expect(p.flush()).toEqual({ sentences: [], command: { action: 'open_notepad' } });
  });

  it('不正な os_command(許可外 action)は command 無しにする', () => {
    const p = createVoiceStreamParser();
    p.push('[[emotion:neutral]]はい。[[os_command:{"action":"rm_rf","target":"/"}]]');
    expect(p.flush().command).toBeUndefined();
  });

  it('target 必須の action で target 欠落なら command 無し', () => {
    const p = createVoiceStreamParser();
    p.push('[[os_command:{"action":"open_browser"}]]');
    expect(p.flush().command).toBeUndefined();
  });
});

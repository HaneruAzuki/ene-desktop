import { describe, it, expect } from 'vitest';
import { parseConversationResponse } from '../../src/conversation/response-parser';

// task_17:応答の reading(音声読み上げ用ひらがな)抽出。

describe('parseConversationResponse - reading', () => {
  it('chat の reading(ひらがな)を抽出する', () => {
    const r = parseConversationResponse(
      '{"type":"chat","message":"今日は3冊読んだ","reading":"きょうはさんさつよんだ"}',
    );
    expect(r).toEqual({ type: 'chat', message: '今日は3冊読んだ', reading: 'きょうはさんさつよんだ' });
  });

  it('reading が無ければ付与しない(欠落時は呼び出し側が message を読む)', () => {
    expect(parseConversationResponse('{"type":"chat","message":"やあ"}')).toEqual({
      type: 'chat',
      message: 'やあ',
    });
  });

  it('reading が文字列でなければ無視する', () => {
    expect(parseConversationResponse('{"type":"chat","message":"やあ","reading":123}')).toEqual({
      type: 'chat',
      message: 'やあ',
    });
  });

  it('emotion と reading を同時に保持する', () => {
    expect(
      parseConversationResponse('{"type":"chat","message":"やった","reading":"やった","emotion":"joy"}'),
    ).toEqual({ type: 'chat', message: 'やった', reading: 'やった', emotion: 'joy' });
  });

  it('os_command にも reading を付与できる', () => {
    expect(
      parseConversationResponse(
        '{"type":"os_command","message":"開くね","reading":"ひらくね","command":{"action":"open_notepad"}}',
      ),
    ).toEqual({
      type: 'os_command',
      message: '開くね',
      reading: 'ひらくね',
      command: { action: 'open_notepad' },
    });
  });
});

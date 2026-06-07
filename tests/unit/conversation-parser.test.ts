import { describe, it, expect } from 'vitest';
import { parseConversationResponse } from '../../src/conversation/response-parser';

describe('parseConversationResponse (設計書 §3.4)', () => {
  it('正常な chat JSON をパースする', () => {
    expect(parseConversationResponse('{"type":"chat","message":"やあ"}')).toEqual({
      type: 'chat',
      message: 'やあ',
    });
  });

  it('コードフェンス付き JSON をパースする', () => {
    expect(parseConversationResponse('```json\n{"type":"chat","message":"x"}\n```')).toEqual({
      type: 'chat',
      message: 'x',
    });
  });

  it('前後にテキストが混入してもパースする', () => {
    expect(parseConversationResponse('はい {"type":"chat","message":"x"} どうぞ')?.type).toBe('chat');
  });

  it('os_command を action 検証つきでパースする', () => {
    const r = parseConversationResponse(
      '{"type":"os_command","message":"開くわよ","command":{"action":"open_browser","target":"https://example.com"}}',
    );
    expect(r).toEqual({
      type: 'os_command',
      message: '開くわよ',
      command: { action: 'open_browser', target: 'https://example.com' },
    });
  });

  it('open_browser で target が無ければ無効(null)', () => {
    expect(
      parseConversationResponse('{"type":"os_command","message":"x","command":{"action":"open_browser"}}'),
    ).toBeNull();
  });

  it('未知の action は無効(null)', () => {
    expect(
      parseConversationResponse('{"type":"os_command","message":"x","command":{"action":"delete_all"}}'),
    ).toBeNull();
  });

  it('open_notepad は target 不要', () => {
    expect(
      parseConversationResponse('{"type":"os_command","message":"x","command":{"action":"open_notepad"}}')?.type,
    ).toBe('os_command');
  });

  it('完全に壊れたデータは null', () => {
    expect(parseConversationResponse('これはJSONではない')).toBeNull();
  });

  it('type が不正なら null', () => {
    expect(parseConversationResponse('{"type":"foo","message":"x"}')).toBeNull();
  });

  // --- emotion(task_13・F-ANIM-06) ---

  it('有効な emotion を取り出す', () => {
    expect(parseConversationResponse('{"type":"chat","message":"うれしい","emotion":"joy"}')).toEqual({
      type: 'chat',
      message: 'うれしい',
      emotion: 'joy',
    });
  });

  it('許可外の emotion は落とす(neutral は表示側で補完)', () => {
    expect(parseConversationResponse('{"type":"chat","message":"x","emotion":"furious"}')).toEqual({
      type: 'chat',
      message: 'x',
    });
  });

  it('emotion 欠落は付与しない(emotion キーなし)', () => {
    const r = parseConversationResponse('{"type":"chat","message":"x"}');
    expect(r).toEqual({ type: 'chat', message: 'x' });
    expect(r && 'emotion' in r).toBe(false);
  });
});

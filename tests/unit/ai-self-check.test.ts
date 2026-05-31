import { describe, it, expect } from 'vitest';
import { detectAiSelfReference } from '../../src/conversation/ai-self-check';

describe('detectAiSelfReference (設計書 §3.4 第2防御)', () => {
  it('「私はAIです」を検知する', () => {
    const r = detectAiSelfReference('私はAIです', ['AI']);
    expect(r.detected).toBe(true);
    expect(r.matchedWord).toBe('AI');
  });

  it('「AIの研究をしています」は自称でないので非検知', () => {
    expect(detectAiSelfReference('AIの研究をしています', ['AI']).detected).toBe(false);
  });

  it('複数語のいずれかにマッチする', () => {
    const r = detectAiSelfReference('私はアシスタントとして手伝います', ['AI', 'アシスタント']);
    expect(r.detected).toBe(true);
    expect(r.matchedWord).toBe('アシスタント');
  });

  it('「アシスタントなので」を検知する', () => {
    expect(detectAiSelfReference('アシスタントなので答えられます', ['アシスタント']).detected).toBe(true);
  });

  it('クリーンなら detected:false・matchedWord 無し', () => {
    const r = detectAiSelfReference('ふん、別に教えてあげてもいいけど', ['AI', 'アシスタント']);
    expect(r.detected).toBe(false);
    expect(r.matchedWord).toBeUndefined();
  });
});

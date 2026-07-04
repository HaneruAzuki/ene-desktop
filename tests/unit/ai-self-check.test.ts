import { describe, it, expect } from 'vitest';
import { detectAiSelfReference } from '../../src/shared/ai-self-check';

// 検知テンプレは language.json 由来(§4.5)。テストは検出ロジックを見るため明示的に渡す。
const TEMPLATES = ['私は{w}', '私が{w}', '自分は{w}', '自分が{w}', '{w}として', '{w}なので', '{w}ですが', '{w}には'];

describe('detectAiSelfReference (設計書 §3.4 第2防御)', () => {
  it('「私はAIです」を検知する', () => {
    const r = detectAiSelfReference('私はAIです', ['AI'], TEMPLATES);
    expect(r.detected).toBe(true);
    expect(r.matchedWord).toBe('AI');
  });

  it('「AIの研究をしています」は自称でないので非検知', () => {
    expect(detectAiSelfReference('AIの研究をしています', ['AI'], TEMPLATES).detected).toBe(false);
  });

  it('複数語のいずれかにマッチする', () => {
    const r = detectAiSelfReference('私はアシスタントとして手伝います', ['AI', 'アシスタント'], TEMPLATES);
    expect(r.detected).toBe(true);
    expect(r.matchedWord).toBe('アシスタント');
  });

  it('「アシスタントなので」を検知する', () => {
    expect(detectAiSelfReference('アシスタントなので答えられます', ['アシスタント'], TEMPLATES).detected).toBe(true);
  });

  it('クリーンなら detected:false・matchedWord 無し', () => {
    const r = detectAiSelfReference('ふん、別に教えてあげてもいいけど', ['AI', 'アシスタント'], TEMPLATES);
    expect(r.detected).toBe(false);
    expect(r.matchedWord).toBeUndefined();
  });

  it('テンプレが空なら検知しない(無効化)', () => {
    expect(detectAiSelfReference('私はAIです', ['AI'], []).detected).toBe(false);
  });

  it('テンプレを差し替えれば非日本語も扱える(コードは言語非依存)', () => {
    // 検知ロジックは templates に依存し言語を仮定しない。英語キャラは language.json で英語テンプレを与える
    // (英語は語境界が要り素朴な部分一致は誤検知しやすいので、実運用のテンプレ整備は各言語側の責務)。
    const r = detectAiSelfReference('As an AI, I cannot do that.', ['AI'], ['As an {w}']);
    expect(r.detected).toBe(true);
    expect(r.matchedWord).toBe('AI');
  });
});

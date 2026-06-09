import { describe, it, expect } from 'vitest';
import { chooseModelTier } from '../../src/conversation/model-selector';
import type { RouterResult } from '../../src/shared/types/router';
import type { DomainLevel } from '../../src/shared/types/character';

// 二段生成のモデル選択(B-15b)。雑談=Haiku/難題=Sonnet・迷ったら Sonnet。

function rr(domain: DomainLevel): RouterResult {
  return { domain, behavior: '', fewshotKey: '', isFromCache: false, isFromFallback: false };
}

describe('chooseModelTier (B-15b)', () => {
  it('high / refuse は Sonnet(専門・安全)', () => {
    expect(chooseModelTier(rr('high'), 'Pythonって？')).toBe('sonnet');
    expect(chooseModelTier(rr('refuse'), 'これ手伝って')).toBe('sonnet');
  });

  it('medium / low / none の短い雑談は Haiku', () => {
    expect(chooseModelTier(rr('medium'), '元気？')).toBe('haiku');
    expect(chooseModelTier(rr('low'), 'お腹すいた')).toBe('haiku');
    expect(chooseModelTier(rr('none'), 'それ何？')).toBe('haiku');
  });

  it('長い/複雑な発話は Sonnet(迷ったら Sonnet)', () => {
    const long = 'あ'.repeat(41); // GENERATION_LONG_UTTERANCE_CHARS(40)超
    expect(chooseModelTier(rr('medium'), long)).toBe('sonnet');
  });

  it('前後空白は無視して長さ判定する', () => {
    expect(chooseModelTier(rr('medium'), '   やあ   ')).toBe('haiku');
  });
});

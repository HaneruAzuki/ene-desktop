import { describe, it, expect } from 'vitest';
import { resolveDomain } from '../../src/knowledge/domain-resolver';
import type { CharacterKnowledgeDomains, KnowledgeDomain } from '../../src/shared/types/character';

function dom(behavior: string, fewshotKey: string): KnowledgeDomain {
  return { topics: [], behavior, rationale: '', fewshotKey };
}

const kd: CharacterKnowledgeDomains = {
  characterId: 'ene',
  fallback: 'medium',
  domains: {
    high: dom('詳しく説明', 'tech_high'),
    medium: dom('一般的に', 'general_medium'),
    low: dom('前置きして', 'general_low'),
    none: dom('困惑する', 'unknown_none'),
    refuse: dom('断る', 'refuse'),
  },
};

describe('resolveDomain (設計書 §3.2)', () => {
  it('指定ドメインの behavior/fewshotKey を返す', () => {
    expect(resolveDomain('high', kd)).toEqual({ behavior: '詳しく説明', fewshotKey: 'tech_high' });
    expect(resolveDomain('none', kd)).toEqual({ behavior: '困惑する', fewshotKey: 'unknown_none' });
  });
});

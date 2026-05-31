import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyTopic, clearRouterCache, type RouterLlmCall } from '../../src/router/router';
import type { CharacterKnowledgeDomains, KnowledgeDomain } from '../../src/shared/types/character';

function dom(topics: string[], behavior: string, fewshotKey: string): KnowledgeDomain {
  return { topics, behavior, rationale: '', fewshotKey };
}

const kd: CharacterKnowledgeDomains = {
  characterId: 'ene',
  fallback: 'medium',
  domains: {
    high: dom(['Python', 'プログラミング'], '詳しく説明する', 'tech_high'),
    medium: dom(['数学'], '一般的に答える', 'general_medium'),
    low: dom(['料理'], '前置きして', 'general_low'),
    none: dom(['パチンコ'], '困惑する', 'unknown_none'),
    refuse: dom(['成人向け'], '断る', 'refuse'),
  },
};

beforeEach(() => clearRouterCache());

describe('classifyTopic (設計書 §3.2)', () => {
  it('成功時は判定ドメインと behavior を返す', async () => {
    const ok: RouterLlmCall = async () => '{"domain":"high","matchedTopic":"Python"}';
    const r = await classifyTopic('Pythonの使い方', kd, 'key', ok);
    expect(r.domain).toBe('high');
    expect(r.behavior).toBe('詳しく説明する');
    expect(r.fewshotKey).toBe('tech_high');
    expect(r.matchedTopic).toBe('Python');
    expect(r.isFromCache).toBe(false);
    expect(r.isFromFallback).toBe(false);
  });

  it('同一入力の2回目はキャッシュヒット(LLM は1回のみ)', async () => {
    let calls = 0;
    const ok: RouterLlmCall = async () => {
      calls++;
      return '{"domain":"none"}';
    };
    const r1 = await classifyTopic('パチンコの新台', kd, 'key', ok);
    const r2 = await classifyTopic('パチンコの新台', kd, 'key', ok);
    expect(r1.isFromCache).toBe(false);
    expect(r2.isFromCache).toBe(true);
    expect(r2.domain).toBe('none');
    expect(calls).toBe(1);
  });

  it('800ms タイムアウトで fallback を返す(例外を投げない)', async () => {
    vi.useFakeTimers();
    try {
      const never: RouterLlmCall = () => new Promise<string>(() => {});
      const p = classifyTopic('時間がかかる入力', kd, 'key', never);
      await vi.advanceTimersByTimeAsync(801);
      const r = await p;
      expect(r.isFromFallback).toBe(true);
      expect(r.domain).toBe('medium'); // fallback
    } finally {
      vi.useRealTimers();
    }
  });

  it('API 失敗時も fallback を返す(例外を投げない)', async () => {
    const fail: RouterLlmCall = async () => {
      throw new Error('401 Unauthorized');
    };
    const r = await classifyTopic('なにか', kd, 'key', fail);
    expect(r.isFromFallback).toBe(true);
    expect(r.domain).toBe('medium');
  });

  it('パース不能な応答でも fallback を返す', async () => {
    const junk: RouterLlmCall = async () => 'これはJSONではない';
    const r = await classifyTopic('別の入力', kd, 'key', junk);
    expect(r.isFromFallback).toBe(true);
  });
});

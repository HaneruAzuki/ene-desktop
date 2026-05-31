import { describe, it, expect } from 'vitest';
import { parseRouterResponse } from '../../src/router/response-parser';

describe('parseRouterResponse (設計書 §3.2)', () => {
  it('正常な JSON をパースする', () => {
    expect(parseRouterResponse('{"domain":"high","matchedTopic":"Python"}')).toEqual({
      domain: 'high',
      matchedTopic: 'Python',
    });
  });

  it('コードフェンス付きでもパースする', () => {
    expect(parseRouterResponse('```json\n{"domain":"none"}\n```')).toEqual({
      domain: 'none',
      matchedTopic: undefined,
    });
  });

  it('前後にテキストが混入してもブレース範囲を抽出する', () => {
    expect(parseRouterResponse('結果はこちら {"domain":"refuse"} です')?.domain).toBe('refuse');
  });

  it('未知の domain 値は null', () => {
    expect(parseRouterResponse('{"domain":"unknown"}')).toBeNull();
  });

  it('JSON でなければ null', () => {
    expect(parseRouterResponse('これはJSONではない')).toBeNull();
  });
});

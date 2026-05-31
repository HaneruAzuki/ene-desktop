import { describe, it, expect } from 'vitest';
import { RouterCache } from '../../src/router/cache';
import type { RouterResult } from '../../src/shared/types/router';

function res(domain: RouterResult['domain']): RouterResult {
  return { domain, behavior: 'b', fewshotKey: 'k', isFromCache: false, isFromFallback: false };
}

describe('RouterCache (要件 F-ROUTE-06)', () => {
  it('set した結果を get できる(キーは正規化)', () => {
    const c = new RouterCache();
    c.set('  Python  ', res('high'));
    expect(c.get('python')?.domain).toBe('high');
  });

  it('11件目で最古が削除される(LRU・最大10件)', () => {
    const c = new RouterCache();
    for (let i = 0; i < 11; i++) c.set(`k${i}`, res('medium'));
    expect(c.size).toBe(10);
    expect(c.get('k0')).toBeUndefined(); // 最古が削除
    expect(c.get('k10')?.domain).toBe('medium');
  });

  it('get したものは最近使用扱いになり、次の eviction を免れる', () => {
    const c = new RouterCache();
    for (let i = 0; i < 10; i++) c.set(`k${i}`, res('low'));
    c.get('k0'); // k0 を最近使用へ
    c.set('k10', res('low')); // eviction 対象は今や k1
    expect(c.get('k1')).toBeUndefined();
    expect(c.get('k0')?.domain).toBe('low');
  });

  it('clear で空になる', () => {
    const c = new RouterCache();
    c.set('a', res('high'));
    c.clear();
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(0);
  });
});

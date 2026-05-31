import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ lock: vi.fn() }));
vi.mock('electron', () => ({ app: { requestSingleInstanceLock: h.lock } }));

import { acquireSingleInstanceLock } from '../../src/main/single-instance';

beforeEach(() => h.lock.mockReset());

describe('single-instance (設計書 §7.1)', () => {
  it('ロック取得に成功すると true を返す', () => {
    h.lock.mockReturnValue(true);
    expect(acquireSingleInstanceLock()).toBe(true);
  });

  it('2つ目のプロセス(既にロック保持)では false を返す', () => {
    h.lock.mockReturnValue(false);
    expect(acquireSingleInstanceLock()).toBe(false);
  });
});

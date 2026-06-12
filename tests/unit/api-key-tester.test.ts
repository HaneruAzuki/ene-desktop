import { describe, it, expect } from 'vitest';
import { isValidKeyFormat, testApiKey } from '../../src/app/main/api-key-tester';

describe('isValidKeyFormat (設計書 §3.7 段階1)', () => {
  it('sk-ant- で始まり50文字以上なら true', () => {
    expect(isValidKeyFormat('sk-ant-' + 'x'.repeat(50))).toBe(true);
  });
  it('プレフィックスが違えば false', () => {
    expect(isValidKeyFormat('xx-key-' + 'x'.repeat(60))).toBe(false);
  });
  it('50文字未満なら false', () => {
    expect(isValidKeyFormat('sk-ant-short')).toBe(false);
  });
});

describe('testApiKey (設計書 §3.7 段階2)', () => {
  it('ping 成功なら ok:true', async () => {
    expect(await testApiKey('k', async () => undefined)).toEqual({ ok: true });
  });

  it('401 は auth', async () => {
    const r = await testApiKey('k', async () => {
      throw { status: 401 };
    });
    expect(r).toEqual({ ok: false, reason: 'auth' });
  });

  it('402 / 429 は credit', async () => {
    expect(
      await testApiKey('k', async () => {
        throw { status: 402 };
      }),
    ).toEqual({ ok: false, reason: 'credit' });
    expect(
      await testApiKey('k', async () => {
        throw { status: 429 };
      }),
    ).toEqual({ ok: false, reason: 'credit' });
  });

  it('ENOTFOUND / ETIMEDOUT は network', async () => {
    expect(
      await testApiKey('k', async () => {
        throw { code: 'ENOTFOUND' };
      }),
    ).toEqual({ ok: false, reason: 'network' });
  });

  it('それ以外は other', async () => {
    const r = await testApiKey('k', async () => {
      throw new Error('boom');
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('other');
  });
});

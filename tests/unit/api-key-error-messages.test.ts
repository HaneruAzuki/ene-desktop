import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../../src/main/api-key-error-messages';

describe('getErrorMessage (設計書 §3.7)', () => {
  it('auth は「APIキーが無効」を含む', () => {
    expect(getErrorMessage('auth')).toContain('APIキーが無効');
  });
  it('credit は「クレジット」「レート上限」を含む', () => {
    const m = getErrorMessage('credit');
    expect(m).toContain('クレジット');
    expect(m).toContain('レート上限');
  });
  it('network は接続に言及する', () => {
    expect(getErrorMessage('network')).toContain('接続');
  });
  it('other は予期しないエラーに言及する', () => {
    expect(getErrorMessage('other')).toContain('予期しない');
  });
});

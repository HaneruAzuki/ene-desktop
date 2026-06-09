import { describe, it, expect } from 'vitest';
import { correctNameMishear } from '../../src/conversation/name-correction';

// STT 名前誤認の保守補正(B-10 Part4)。発話全体が名前エイリアスのときだけ自称へ。
const ALIASES = ['取り身', 'とり身', '鳥見'];
const NAME = 'トリミ';

describe('correctNameMishear', () => {
  it('発話全体がエイリアスなら自称へ置換する', () => {
    expect(correctNameMishear('取り身', ALIASES, NAME)).toBe('トリミ');
    expect(correctNameMishear('鳥見', ALIASES, NAME)).toBe('トリミ');
  });

  it('末尾の句読点・感嘆は保持する', () => {
    expect(correctNameMishear('取り身！', ALIASES, NAME)).toBe('トリミ！');
    expect(correctNameMishear('取り身。', ALIASES, NAME)).toBe('トリミ。');
    expect(correctNameMishear('取り身？', ALIASES, NAME)).toBe('トリミ？');
  });

  it('前後の空白を無視して判定する', () => {
    expect(correctNameMishear('  取り身  ', ALIASES, NAME)).toBe('トリミ');
  });

  it('文中にエイリアスを含むだけなら触らない(過補正しない)', () => {
    expect(correctNameMishear('取り身ってどうやるの？', ALIASES, NAME)).toBe('取り身ってどうやるの？');
    expect(correctNameMishear('魚の取り身の話', ALIASES, NAME)).toBe('魚の取り身の話');
  });

  it('エイリアスでなければそのまま', () => {
    expect(correctNameMishear('こんにちは', ALIASES, NAME)).toBe('こんにちは');
  });

  it('エイリアス空 / 自称空なら何もしない', () => {
    expect(correctNameMishear('取り身', [], NAME)).toBe('取り身');
    expect(correctNameMishear('取り身', ALIASES, '')).toBe('取り身');
  });
});

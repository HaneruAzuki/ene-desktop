import { describe, it, expect } from 'vitest';
import { correctNameMishear } from '../../src/voice/name-correction';

// STT 名前誤認の保守補正(B-10 Part4)。**呼びかけ位置**(先頭/末尾、句読点・空白区切り)で自称へ置換。
// 文中の正当語(取り見る/鳥見に行く 等)は触らない=過補正回避。
const ALIASES = ['取り身', '取り見', 'とり身', '鳥見'];
const NAME = 'トリミ';

describe('correctNameMishear', () => {
  it('発話全体がエイリアスなら自称へ置換する', () => {
    expect(correctNameMishear('取り身', ALIASES, NAME)).toBe('トリミ');
    expect(correctNameMishear('取り見', ALIASES, NAME)).toBe('トリミ');
    expect(correctNameMishear('鳥見', ALIASES, NAME)).toBe('トリミ');
  });

  it('末尾の句読点・感嘆は保持する', () => {
    expect(correctNameMishear('取り身！', ALIASES, NAME)).toBe('トリミ！');
    expect(correctNameMishear('取り見。', ALIASES, NAME)).toBe('トリミ。');
    expect(correctNameMishear('取り身？', ALIASES, NAME)).toBe('トリミ？');
  });

  it('前後の空白があっても先頭の呼びかけとして置換する', () => {
    expect(correctNameMishear('  取り身  ', ALIASES, NAME)).toBe('  トリミ  ');
  });

  it('先頭の呼びかけ(綴り＋句読点)を自称へ置換する', () => {
    expect(correctNameMishear('取り見、今日ね', ALIASES, NAME)).toBe('トリミ、今日ね');
    expect(correctNameMishear('取り身。聞いてよ', ALIASES, NAME)).toBe('トリミ。聞いてよ');
  });

  it('末尾の呼びかけ(句読点＋綴り)を自称へ置換する', () => {
    expect(correctNameMishear('ねえ、取り身', ALIASES, NAME)).toBe('ねえ、トリミ');
    expect(correctNameMishear('おはよう、取り見', ALIASES, NAME)).toBe('おはよう、トリミ');
  });

  it('文中の正当語は触らない(過補正しない)', () => {
    // 「取り見る/取り見て」由来(区切りが無い)→ 触らない
    expect(correctNameMishear('メモを取り見直した', ALIASES, NAME)).toBe('メモを取り見直した');
    // 鳥見(バードウォッチング)が文中/末尾でも、区切りが無ければ触らない
    expect(correctNameMishear('鳥見に行く', ALIASES, NAME)).toBe('鳥見に行く');
    expect(correctNameMishear('今日は鳥見', ALIASES, NAME)).toBe('今日は鳥見');
    // 区切り無しで続く呼称風も触らない(誤爆回避・保守)
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

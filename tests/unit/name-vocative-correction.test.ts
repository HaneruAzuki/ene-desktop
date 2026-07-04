import { describe, it, expect } from 'vitest';
import { correctVocativeName } from '../../src/conversation/name-mishear';

// STT が固有名「トリミ」を同音異字(鳥見等)へ誤変換した分を、呼びかけ位置に限って決定論的に戻す。
const A = ['鳥見', '取り見', 'とりみ'];

describe('correctVocativeName (STT 同音異字の呼びかけ補正)', () => {
  it('発話全体が誤変換名なら名前に戻す', () => {
    expect(correctVocativeName('鳥見', 'トリミ', A)).toBe('トリミ');
    expect(correctVocativeName('  鳥見  ', 'トリミ', A)).toBe('トリミ');
  });
  it('文頭の呼びかけ(直後が境界)は戻す', () => {
    expect(correctVocativeName('鳥見、おはよう', 'トリミ', A)).toBe('トリミ、おはよう');
    expect(correctVocativeName('鳥見 おはよう', 'トリミ', A)).toBe('トリミ おはよう');
  });
  it('文末の呼びかけ(直前が境界)は戻す', () => {
    expect(correctVocativeName('おはよう、鳥見', 'トリミ', A)).toBe('おはよう、トリミ');
  });
  it('文中の自然語(野鳥観察など)は誤補正しない', () => {
    expect(correctVocativeName('今日鳥見に行った', 'トリミ', A)).toBe('今日鳥見に行った');
  });
  it('誤変換名が無ければ素通し / aliases 空なら素通し', () => {
    expect(correctVocativeName('おはよう', 'トリミ', A)).toBe('おはよう');
    expect(correctVocativeName('鳥見', 'トリミ', [])).toBe('鳥見');
  });
});

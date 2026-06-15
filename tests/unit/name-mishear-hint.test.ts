import { describe, it, expect } from 'vitest';
import { buildNameMishearHint, withNameMishearHint } from '../../src/conversation/prompt-builder';

// STT 同音異字の読み替え指示(機械置換は廃止し、Claude に文脈で読み替えさせる)。
// キャラ名はハードコードせず汎用の架空値で検証する(§5.1 配慮)。

describe('buildNameMishearHint', () => {
  it('callsSelf と aliases から読み替え指示文を組む', () => {
    const h = buildNameMishearHint('ナマエ', ['アヤマリ甲', 'アヤマリ乙']);
    expect(h).toContain('ナマエ');
    expect(h).toContain('「アヤマリ甲」');
    expect(h).toContain('「アヤマリ乙」');
  });

  it('aliases が空(または空文字のみ)なら指示を出さない=空文字', () => {
    expect(buildNameMishearHint('ナマエ', [])).toBe('');
    expect(buildNameMishearHint('ナマエ', ['', '  '.trim()])).toBe('');
  });

  it('callsSelf が空なら空文字', () => {
    expect(buildNameMishearHint('', ['アヤマリ甲'])).toBe('');
  });
});

describe('withNameMishearHint', () => {
  it('hint を system へ前置きして包む(user/maxTokens は素通し)', async () => {
    const seen: { system: string; user: string }[] = [];
    const base = async (req: { system: string; user: string; maxTokens?: number }): Promise<string> => {
      seen.push({ system: req.system, user: req.user });
      return 'ok';
    };
    const wrapped = withNameMishearHint(base, 'ヒント文');
    const out = await wrapped({ system: '元のsystem', user: '本文' });
    expect(out).toBe('ok');
    expect(seen[0].system).toContain('元のsystem');
    expect(seen[0].system).toContain('ヒント文');
    expect(seen[0].user).toBe('本文');
  });

  it('hint が空なら同一関数を返す(素通し)', () => {
    const base = async (): Promise<string> => 'x';
    expect(withNameMishearHint(base, '')).toBe(base);
  });
});

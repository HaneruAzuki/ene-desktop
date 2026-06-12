import { describe, it, expect } from 'vitest';
import { stripRuby, rubyToReading } from '../../src/conversation/ruby';

// 青空文庫式ルビの解決(Claude振り仮名方式)。

const EXAMPLE = '最近、夏目漱石の心《こころ》を読みました。向上心《こうじょうしん》は大切だと思いました。';

describe('ruby (Claude振り仮名)', () => {
  it('表示用はルビを除去し漢字を残す', () => {
    expect(stripRuby(EXAMPLE)).toBe(
      '最近、夏目漱石の心を読みました。向上心は大切だと思いました。',
    );
  });

  it('音声用は基底《よみ》を読みに置換し、同形異音語を読み分ける', () => {
    expect(rubyToReading(EXAMPLE)).toBe(
      '最近、夏目漱石のこころを読みました。こうじょうしんは大切だと思いました。',
    );
  });

  it('ルビが無ければ表示・音声とも素のまま', () => {
    const s = 'やあ、元気?';
    expect(stripRuby(s)).toBe(s);
    expect(rubyToReading(s)).toBe(s);
  });

  it('｜で基底の先頭を明示できる', () => {
    const s = '私の｜心《こころ》';
    expect(stripRuby(s)).toBe('私の心');
    expect(rubyToReading(s)).toBe('私のこころ');
  });

  it('数字・記号のルビも置換する', () => {
    const s = '今日は3冊《さんさつ》読んだ';
    expect(stripRuby(s)).toBe('今日は3冊読んだ');
    expect(rubyToReading(s)).toBe('今日はさんさつ読んだ');
  });
});

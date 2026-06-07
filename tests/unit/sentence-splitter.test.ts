import { describe, it, expect } from 'vitest';
import { splitSentences } from '../../src/conversation/sentence-splitter';

// task_17 C3:ストリーミング TTS 用の日本語文分割(design-revision-voice §2)。

describe('splitSentences', () => {
  it('句点・感嘆・疑問で区切り、残りを remainder に返す', () => {
    const r = splitSentences('こんにちは。元気？はい');
    expect(r.complete).toEqual(['こんにちは。', '元気？']);
    expect(r.remainder).toBe('はい');
  });

  it('文末記号が無ければ全体が remainder(未完)', () => {
    const r = splitSentences('まだ途中の文');
    expect(r.complete).toEqual([]);
    expect(r.remainder).toBe('まだ途中の文');
  });

  it('改行も文境界として扱う(改行自体は含めない)', () => {
    const r = splitSentences('一行目\n二行目');
    expect(r.complete).toEqual(['一行目']);
    expect(r.remainder).toBe('二行目');
  });

  it('連続する文末記号は 1 文にまとめる', () => {
    const r = splitSentences('本当！？すごい。');
    expect(r.complete).toEqual(['本当！？', 'すごい。']);
    expect(r.remainder).toBe('');
  });

  it('半角の ! ? も文末として扱う', () => {
    const r = splitSentences('Yes! No?');
    expect(r.complete).toEqual(['Yes!', 'No?']);
  });

  it('空白のみ/空行はトリムして除外する', () => {
    const r = splitSentences('ok。\n\n次。');
    expect(r.complete).toEqual(['ok。', '次。']);
    expect(r.remainder).toBe('');
  });

  it('読点(、)では区切らない', () => {
    const r = splitSentences('あのね、それでね');
    expect(r.complete).toEqual([]);
    expect(r.remainder).toBe('あのね、それでね');
  });
});

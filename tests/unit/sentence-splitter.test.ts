import { describe, it, expect } from 'vitest';
import { splitSentences, splitFirstChunk } from '../../src/conversation/sentence-splitter';

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

describe('splitFirstChunk(第一声短縮・施策A)', () => {
  it('最初の読点(、)で早期に切り出す', () => {
    expect(splitFirstChunk('ふん、別に来たわけじゃない', 20)).toEqual({
      chunk: 'ふん、',
      remainder: '別に来たわけじゃない',
    });
  });

  it('読点より前に文末が来ればそこで切る(文末記号の連続もまとめる)', () => {
    expect(splitFirstChunk('えっ！？まじで、', 20)).toEqual({
      chunk: 'えっ！？',
      remainder: 'まじで、',
    });
  });

  it('句読点が無く字数上限を超えたら上限で切る', () => {
    // 26文字・読点なし → maxChars=20 の安全点で区切る
    const buf = 'あいうえおかきくけこさしすせそたちつてとなにぬねのは';
    const r = splitFirstChunk(buf, 20);
    expect(r).not.toBeNull();
    expect(r?.chunk.length).toBe(20);
    expect((r?.chunk ?? '') + (r?.remainder ?? '')).toBe(buf);
  });

  it('境界(句読点/字数)がまだ無ければ null(次の delta を待つ)', () => {
    expect(splitFirstChunk('ふん', 20)).toBeNull();
  });

  it('ルビ《…》の途中では切らない(読点はルビ前で拾う)', () => {
    // 「心」の直後にルビ。最初の読点は「は」の後。ルビは丸ごとチャンクに含む。
    expect(splitFirstChunk('私の心《こころ》は、揺れた。', 20)).toEqual({
      chunk: '私の心《こころ》は、',
      remainder: '揺れた。',
    });
  });

  it('字数上限の到達点の直後が《(ルビ開始)なら、基底とルビを割らずに待つ(null)', () => {
    // 実文字19個 +「心」(20個目)+《こころ》。20到達点=「心」の直後が《 なので切らずに待つ。
    const buf = 'あいうえおかきくけこさしすせそたちつて心《こころ》';
    expect(splitFirstChunk(buf, 20)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { selectBackchannel } from '../../src/conversation/backchannel-pool';
import type { BackchannelPoolData } from '../../src/shared/types/backchannel';

// selectBackchannel は純粋ロジック(語プール＋型＋注入RNG → 語)。反復回避とフォールバックを検証する。

const POOL: BackchannelPoolData = {
  version: 1,
  cues: {
    continuer: ['うん', 'うんうん', 'ふんふん'],
    understanding: ['なるほど', 'そっか'],
    surprise: [],
  },
  thinkingFiller: ['うーん'],
};

/** 常に先頭(index 0)を選ぶ RNG。 */
const rng0 = (): number => 0;

describe('selectBackchannel (task_18 Phase A)', () => {
  it('型に応じた候補から選ぶ', () => {
    expect(selectBackchannel(POOL, 'understanding', rng0)).toBe('なるほど');
  });

  it('RNG に応じて候補内で選ぶ', () => {
    // index = floor(rng * len)。len=3 で rng=0.5 → index 1。
    expect(selectBackchannel(POOL, 'continuer', () => 0.5)).toBe('うんうん');
  });

  it('候補が空の型は continuer にフォールバック', () => {
    expect(selectBackchannel(POOL, 'surprise', rng0)).toBe('うん'); // surprise=[] → continuer[0]
  });

  it('定義のない型も continuer にフォールバック', () => {
    expect(selectBackchannel(POOL, 'empathy', rng0)).toBe('うん');
  });

  it('直前と同じ語は可能なら避ける(反復回避)', () => {
    // continuer の先頭は「うん」。avoid='うん' なら、rng=0 でも「うん」以外を返す。
    const got = selectBackchannel(POOL, 'continuer', rng0, 'うん');
    expect(got).not.toBe('うん');
    expect(['うんうん', 'ふんふん']).toContain(got);
  });

  it('2語あれば avoid を除いた方を返す', () => {
    // understanding=['なるほど','そっか']。avoid='なるほど' → 'そっか' を返す。
    expect(selectBackchannel(POOL, 'understanding', rng0, 'なるほど')).toBe('そっか');
  });

  it('候補が1語しかなければ avoid でもその語を返す(無言にしない)', () => {
    const single: BackchannelPoolData = { version: 1, cues: { continuer: ['うん'] } };
    expect(selectBackchannel(single, 'continuer', rng0, 'うん')).toBe('うん');
  });

  it('プールが完全に空でも最終フォールバックで無言にしない', () => {
    const empty: BackchannelPoolData = { version: 1, cues: {} };
    expect(selectBackchannel(empty, 'continuer', rng0)).toBe('うん');
  });
});

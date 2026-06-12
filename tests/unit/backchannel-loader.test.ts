import { describe, it, expect } from 'vitest';
import { validateBackchannelPool } from '../../src/voice/backchannel-loader';

// backchannels.json の検証(純粋ロジック)。continuer 必須・型ごとに空でない文字列のみ採用。

describe('validateBackchannelPool (task_18 Phase B)', () => {
  it('正常な pool を正規化する', () => {
    const pool = validateBackchannelPool({
      version: 1,
      cues: { continuer: ['うん', 'へえ'], understanding: ['なるほど'] },
      thinkingFiller: ['うーん'],
    });
    expect(pool).not.toBeNull();
    expect(pool?.cues.continuer).toEqual(['うん', 'へえ']);
    expect(pool?.cues.understanding).toEqual(['なるほど']);
    expect(pool?.thinkingFiller).toEqual(['うーん']);
  });

  it('continuer が無ければ null(フォールバック先が無い)', () => {
    expect(validateBackchannelPool({ version: 1, cues: { surprise: ['えっ'] } })).toBeNull();
  });

  it('continuer が空配列なら null', () => {
    expect(validateBackchannelPool({ version: 1, cues: { continuer: [] } })).toBeNull();
  });

  it('非文字列・空文字は除外する', () => {
    const pool = validateBackchannelPool({
      version: 1,
      cues: { continuer: ['うん', '', 42, null, 'ふんふん'] },
    });
    expect(pool?.cues.continuer).toEqual(['うん', 'ふんふん']);
  });

  it('thinkingFiller が無くても可(任意)', () => {
    const pool = validateBackchannelPool({ version: 1, cues: { continuer: ['うん'] } });
    expect(pool?.thinkingFiller).toBeUndefined();
  });

  it('version が無い/cues が無い → null', () => {
    expect(validateBackchannelPool({ cues: { continuer: ['うん'] } })).toBeNull();
    expect(validateBackchannelPool({ version: 1 })).toBeNull();
    expect(validateBackchannelPool(null)).toBeNull();
    expect(validateBackchannelPool('x')).toBeNull();
  });
});

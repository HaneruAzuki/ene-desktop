import { describe, it, expect } from 'vitest';
import {
  buildOffscreenLifePrompt,
  parseOffscreenLifeResponse,
} from '../../src/conversation/offscreen-life';

// P3: オフスクリーンライフの生成プロンプト/パース(純粋部分)。

describe('buildOffscreenLifePrompt (P3)', () => {
  it('経過・近況・連続性の材料を織り込み、断片ありなら life を要求する', () => {
    const p = buildOffscreenLifePrompt({
      systemPrompt: 'あなたはトリミ。',
      elapsedLabel: '3日ぶり',
      timeOfDay: '夜',
      currentStatus: '締め切り前で忙しい',
      currentHobbies: ['ゲーム'],
      recentLife: ['昨日は雨で一日中コードを書いた'],
      openLoops: ['面接の結果待ち'],
      makeFragment: true,
    });
    expect(p.system).toContain('"life"');
    expect(p.user).toContain('3日ぶり');
    expect(p.user).toContain('締め切り前で忙しい');
    expect(p.user).toContain('昨日は雨で一日中コードを書いた');
    expect(p.user).toContain('面接の結果待ち');
  });

  it('同日2回目(makeFragment=false)は life を求めず greeting のみ', () => {
    const p = buildOffscreenLifePrompt({
      systemPrompt: 'あなたはトリミ。',
      timeOfDay: '昼',
      recentLife: [],
      openLoops: [],
      makeFragment: false,
    });
    expect(p.system).toContain('"greeting"');
    expect(p.system).not.toContain('"life"');
  });
});

describe('parseOffscreenLifeResponse (P3)', () => {
  it('greeting と life を取り出す', () => {
    const r = parseOffscreenLifeResponse(
      '{"greeting":"あ、来た。3日ぶりじゃない","life":"昨日は一日中コードを書いてた"}',
    );
    expect(r?.greeting).toBe('あ、来た。3日ぶりじゃない');
    expect(r?.life).toBe('昨日は一日中コードを書いてた');
  });
  it('life が無くても greeting だけ返す', () => {
    const r = parseOffscreenLifeResponse('{"greeting":"また来たの"}');
    expect(r?.greeting).toBe('また来たの');
    expect(r?.life).toBeUndefined();
  });
  it('greeting が無ければ null(フォールバックへ倒す)', () => {
    expect(parseOffscreenLifeResponse('{"life":"x"}')).toBeNull();
    expect(parseOffscreenLifeResponse('こわれた')).toBeNull();
  });
});

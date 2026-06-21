import { describe, it, expect } from 'vitest';
import { buildOffscreenLifePrompt, parseGreeting } from '../../src/app/main/offscreen-life';

// P3: オフスクリーンライフの挨拶生成プロンプト/パース(純粋部分・パック駆動・単機能化後)。

describe('buildOffscreenLifePrompt (P3)', () => {
  it('経過・今週の出来事・近況・気にかけを織り込み、挨拶だけを求める(life は求めない)', () => {
    const p = buildOffscreenLifePrompt({
      systemPrompt: 'あなたはトリミ。',
      elapsedLabel: '3日ぶり',
      timeOfDay: '夜',
      todayBeat: '弾幕ゲーのバグと格闘していた',
      recentLife: ['昨日は雨で一日中コードを書いた'],
      openLoops: ['面接の結果待ち'],
    });
    expect(p.system).toContain('第一声');
    expect(p.system).not.toContain('"life"');
    expect(p.user).toContain('3日ぶり');
    expect(p.user).toContain('弾幕ゲーのバグと格闘していた');
    expect(p.user).toContain('昨日は雨で一日中コードを書いた');
    expect(p.user).toContain('面接の結果待ち');
  });

  it('材料が無ければ時間帯だけの簡素なプロンプト', () => {
    const p = buildOffscreenLifePrompt({
      systemPrompt: 'あなたはトリミ。',
      timeOfDay: '昼',
      recentLife: [],
      openLoops: [],
    });
    expect(p.user).toContain('昼');
    expect(p.user).not.toContain('最近の暮らし');
    expect(p.user).not.toContain('気にかけ');
  });
});

describe('parseGreeting (P3)', () => {
  it('素のテキストをトリムして返す', () => {
    expect(parseGreeting('  また来たの  ')).toBe('また来たの');
  });
  it('空・空白なら null(フォールバックへ倒す)', () => {
    expect(parseGreeting('')).toBeNull();
    expect(parseGreeting('   ')).toBeNull();
  });
});

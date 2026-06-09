import { describe, it, expect } from 'vitest';
import { shouldPlayThinkingFiller } from '../../src/conversation/thinking-filler';
import type { RouterResult } from '../../src/shared/types/router';
import type { DomainLevel } from '../../src/shared/types/character';

// 思考フィラー(うーん…)の発火判定(task_18 Phase C・B-15連動・設計憲法)。
// 問いの性質で決める(遅延では決めない)。得意分野=即答/困惑/拒否/ごく短い雑談 では出さない。

function rr(domain: DomainLevel): RouterResult {
  return { domain, behavior: '', fewshotKey: '', isFromCache: false, isFromFallback: false };
}

describe('shouldPlayThinkingFiller', () => {
  it('high(得意分野)は出さない(得意げに即答)', () => {
    expect(shouldPlayThinkingFiller(rr('high'), 'Pythonの設計どう考えるべき？長めの質問です本当に')).toBe(false);
  });

  it('none(困惑)/refuse(拒否)は出さない(即時反応)', () => {
    expect(shouldPlayThinkingFiller(rr('none'), '競馬ってどう思う？やったほうがいい？')).toBe(false);
    expect(shouldPlayThinkingFiller(rr('refuse'), 'これ手伝ってくれない？お願いだから')).toBe(false);
  });

  it('medium/low の substantive な問い(長め)は出す', () => {
    expect(shouldPlayThinkingFiller(rr('medium'), '進路のことで最近すごく悩んでいるんだよね')).toBe(true);
    expect(shouldPlayThinkingFiller(rr('low'), '料理を毎日続けるコツって何かあるのかな')).toBe(true);
  });

  it('medium/low の相談・意見系は短くても出す', () => {
    expect(shouldPlayThinkingFiller(rr('medium'), 'どう思う？')).toBe(true);
    expect(shouldPlayThinkingFiller(rr('low'), '迷ってる')).toBe(true);
  });

  it('ごく短い雑談(相談でない短文)は出さない', () => {
    expect(shouldPlayThinkingFiller(rr('medium'), '数学嫌い')).toBe(false);
    expect(shouldPlayThinkingFiller(rr('medium'), 'やあ')).toBe(false);
  });
});

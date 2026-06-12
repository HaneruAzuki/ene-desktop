import { describe, it, expect } from 'vitest';
import { shouldPlayThinkingFiller } from '../../src/voice/thinking-filler';
import type { RouterResult } from '../../src/shared/types/router';
import type { DomainLevel } from '../../src/shared/types/character';

// 思考フィラー(うーん…)の発火判定(task_18 Phase C・B-15連動・設計憲法)。
// 相談・意見系は topic 分類に関わらず発火(誤分類に強い)。refuse(拒否)だけ除外。
// 非相談の長文は medium/low のみ(得意分野=得意げに説明 / 困惑では出さない)。

function rr(domain: DomainLevel): RouterResult {
  return { domain, behavior: '', fewshotKey: '', isFromCache: false, isFromFallback: false };
}

describe('shouldPlayThinkingFiller', () => {
  it('相談・意見系は topic 分類に関わらず出す(none/high 誤分類も拾う)', () => {
    // 「どう思う」「悩んでてさ」は短く topic 無し → discriminator が none/high に誤分類しがち。形で拾う。
    expect(shouldPlayThinkingFiller(rr('none'), 'どう思う')).toBe(true);
    expect(shouldPlayThinkingFiller(rr('high'), '最近悩んでてさ')).toBe(true); // high 誤分類でも相談形なら出す
    expect(shouldPlayThinkingFiller(rr('medium'), 'どう思う？')).toBe(true);
    expect(shouldPlayThinkingFiller(rr('low'), '迷ってる')).toBe(true);
  });

  it('refuse(拒否)は相談形でも出さない(即時に断る)', () => {
    expect(shouldPlayThinkingFiller(rr('refuse'), 'これ手伝ってくれない？どうしても')).toBe(false);
  });

  it('得意分野の非相談(得意げに説明)は出さない', () => {
    expect(shouldPlayThinkingFiller(rr('high'), 'デコレータの仕組みを詳しく教えて欲しいんだけど')).toBe(false);
  });

  it('非相談でも medium/low の長め(substantive)なら出す', () => {
    expect(shouldPlayThinkingFiller(rr('medium'), '進路のことをそろそろ真剣に考えないとなあ')).toBe(true);
    expect(shouldPlayThinkingFiller(rr('low'), '料理を毎日続けるのって意外と大変なんだよね')).toBe(true);
  });

  it('短い雑談(相談でない短文)/ 困惑は出さない', () => {
    expect(shouldPlayThinkingFiller(rr('medium'), '数学嫌い')).toBe(false);
    expect(shouldPlayThinkingFiller(rr('medium'), 'やあ')).toBe(false);
    expect(shouldPlayThinkingFiller(rr('none'), 'それ何')).toBe(false);
  });
});

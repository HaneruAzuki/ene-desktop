import { describe, it, expect } from 'vitest';
import { enhancePromptForRegeneration } from '../../src/conversation/prompt-enhancer';

describe('enhancePromptForRegeneration (設計書 §3.4 第3防御)', () => {
  it('元の system・検知語・再生成指示を含む', () => {
    const enhanced = enhancePromptForRegeneration('もとのシステムプロンプト', 'AI');
    expect(enhanced).toContain('もとのシステムプロンプト');
    expect(enhanced).toContain('AI');
    expect(enhanced).toContain('再生成');
  });
});

import { describe, it, expect } from 'vitest';
import { enhancePromptForRegeneration } from '../../src/conversation/prompt-enhancer';
import type { SystemBlock } from '../../src/shared/types/conversation';

describe('enhancePromptForRegeneration (設計書 §3.4 第3防御 / task_14)', () => {
  const base: SystemBlock[] = [{ type: 'text', text: 'もとのシステムプロンプト', cacheable: true }];

  it('元の system・検知語・再生成指示を含む', () => {
    const enhanced = enhancePromptForRegeneration(base, 'AI');
    const text = enhanced.map((b) => b.text).join('\n');
    expect(text).toContain('もとのシステムプロンプト');
    expect(text).toContain('AI');
    expect(text).toContain('再生成');
  });

  it('Tier0(先頭ブロック)の cacheable を保ち、強化文は非キャッシュの追加ブロック', () => {
    const enhanced = enhancePromptForRegeneration(base, 'AI');
    expect(enhanced[0]?.cacheable).toBe(true); // Tier0 はそのまま
    expect(enhanced[enhanced.length - 1]?.cacheable).toBeFalsy(); // 追加分は非キャッシュ
    expect(enhanced.length).toBe(base.length + 1);
  });
});

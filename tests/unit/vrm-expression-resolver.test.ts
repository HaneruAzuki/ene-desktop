import { describe, it, expect } from 'vitest';
import { managedPresets, resolveExpressionWeights } from '../../src/renderer/vrm/expression-resolver';
import type { VrmExpressionMap } from '../../src/shared/types/vrm';

// vrm.json と同じ既定マップで検証する。
const MAP: VrmExpressionMap = {
  neutral: 'neutral',
  joy: 'happy',
  anger: 'angry',
  sorrow: 'sad',
  surprise: 'surprised',
  embarrassed: 'relaxed',
};

describe('vrm expression resolver', () => {
  it('managedPresets は neutral を除いた重複なしのプリセット集合', () => {
    expect(managedPresets(MAP).sort()).toEqual(['angry', 'happy', 'relaxed', 'sad', 'surprised']);
  });

  it('joy は happy だけ 1・他は 0', () => {
    const w = resolveExpressionWeights(MAP, 'joy');
    expect(w.happy).toBe(1);
    expect(w.angry).toBe(0);
    expect(w.sad).toBe(0);
    expect(w.surprised).toBe(0);
    expect(w.relaxed).toBe(0);
  });

  it('surprise は surprised に対応する(予約ではなく実ラベル)', () => {
    expect(resolveExpressionWeights(MAP, 'surprise').surprised).toBe(1);
  });

  it('neutral は全プリセット 0(素の顔)', () => {
    const w = resolveExpressionWeights(MAP, 'neutral');
    expect(Object.values(w).every((v) => v === 0)).toBe(true);
  });

  it("'neutral' プリセットは管理対象に含めない(setValue 対象にしない)", () => {
    expect(managedPresets(MAP)).not.toContain('neutral');
  });

  it('未マップ emotion は全 0(安全側)', () => {
    const partial: VrmExpressionMap = { joy: 'happy' };
    const w = resolveExpressionWeights(partial, 'anger');
    expect(w.happy).toBe(0);
  });
});

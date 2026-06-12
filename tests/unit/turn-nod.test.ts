import { describe, it, expect } from 'vitest';
import { turnNodStrength } from '../../src/voice/turn-nod';
import {
  TURN_NOD_LONG_THRESHOLD_MS,
  TURN_NOD_STRENGTH_SHORT,
  TURN_NOD_STRENGTH_LONG,
} from '../../src/shared/constants';

describe('turnNodStrength', () => {
  it('閾値未満(短い発話)は軽いうなずき', () => {
    expect(turnNodStrength(0)).toBe(TURN_NOD_STRENGTH_SHORT);
    expect(turnNodStrength(3000)).toBe(TURN_NOD_STRENGTH_SHORT);
    expect(turnNodStrength(TURN_NOD_LONG_THRESHOLD_MS - 1)).toBe(TURN_NOD_STRENGTH_SHORT);
  });

  it('閾値以上(長い発話)は重めのうなずき', () => {
    expect(turnNodStrength(TURN_NOD_LONG_THRESHOLD_MS)).toBe(TURN_NOD_STRENGTH_LONG);
    expect(turnNodStrength(20000)).toBe(TURN_NOD_STRENGTH_LONG);
  });

  it('重めは軽めより深い(出し分けの向き)', () => {
    expect(TURN_NOD_STRENGTH_LONG).toBeGreaterThan(TURN_NOD_STRENGTH_SHORT);
  });
});

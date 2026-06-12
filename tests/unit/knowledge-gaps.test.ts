import { describe, it, expect } from 'vitest';
import { selectKnowledgeGaps } from '../../src/memory/knowledge-gaps';
import type { SemanticMemory } from '../../src/shared/types/memory';

// P5: 知識ギャップ(まだ知らない相手の属性)を親密度ゲート付きで選ぶ。

const empty: SemanticMemory = { version: 1 };

describe('selectKnowledgeGaps (P5)', () => {
  it('段階1では名前だけを聞ける(読み・好み・誕生日はゲート外)', () => {
    expect(selectKnowledgeGaps(empty, 1)).toEqual(['相手の名前']);
  });

  it('名前が分かっていれば、段階2で次のギャップ(読み)を聞ける', () => {
    const s: SemanticMemory = { version: 1, userName: '優希' };
    expect(selectKnowledgeGaps(s, 2)).toEqual(['相手の名前の読み(かな)']);
  });

  it('一度に出すのは1件まで(尋問にしない)', () => {
    const s: SemanticMemory = { version: 1, userName: '優希' };
    expect(selectKnowledgeGaps(s, 5).length).toBe(1);
  });

  it('誕生日は段階3以上で初めて聞ける', () => {
    const s: SemanticMemory = {
      version: 1,
      userName: '優希',
      userNameReading: 'ゆうき',
      preferences: { 好きな食べ物: 'ラーメン' },
    };
    expect(selectKnowledgeGaps(s, 2)).toEqual([]); // 段階2では誕生日ゲート未到達=聞くことがない
    expect(selectKnowledgeGaps(s, 3)).toEqual(['相手の誕生日']);
  });

  it('すべて埋まっていれば何も聞かない', () => {
    const s: SemanticMemory = {
      version: 1,
      userName: '優希',
      userNameReading: 'ゆうき',
      preferences: { 好きな食べ物: 'ラーメン' },
      userBirthday: { month: 6, day: 12 },
    };
    expect(selectKnowledgeGaps(s, 5)).toEqual([]);
  });
});

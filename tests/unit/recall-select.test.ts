import { describe, it, expect } from 'vitest';
import { pickDiverse, topicKey } from '../../src/memory/recall/recall-select';
import type { EpisodicMemory, EpisodicRecord } from '../../src/shared/types/memory';

// 想起の多様性選抜(P2)の純関数検証。乱数・I/O を持たない決定論ロジック。

function mem(p: Partial<EpisodicMemory>): EpisodicMemory {
  return { date: '2026-01-01T00:00:00+09:00', topic: 't', summary: 's', importance: 3, category: 'general', ...p };
}
function rec(id: string, p: Partial<EpisodicMemory>): EpisodicRecord {
  return { id, memory: mem(p) };
}

describe('recall-select — topicKey', () => {
  it('topic を正規化(trim/小文字)し、空なら category へ倒す', () => {
    expect(topicKey(mem({ topic: ' Work ' }))).toBe('work');
    expect(topicKey(mem({ topic: '', category: 'Health' }))).toBe('health');
  });
});

describe('recall-select — pickDiverse(P2 多様性)', () => {
  it('同一トピックの占有を topicMax に抑え、別話題を差し込む', () => {
    const recs = [
      rec('a1', { topic: 'A' }),
      rec('a2', { topic: 'A' }),
      rec('a3', { topic: 'A' }),
      rec('b1', { topic: 'B' }),
    ];
    const byId = new Map(recs.map((r) => [r.id, r]));
    // 関連順では A が独占しているが、cap=2 で B が差し込まれる。
    const picked = pickDiverse(['a1', 'a2', 'a3', 'b1'], byId, 3, 2);
    const topics = picked.map((r) => r.memory.topic);
    expect(topics.filter((t) => t === 'A').length).toBe(2);
    expect(topics).toContain('B');
    expect(picked.length).toBe(3);
  });

  it('別話題が枯れていれば上限を無視して補充する(従来より少なく返さない)', () => {
    const recs = [rec('a1', { topic: 'A' }), rec('a2', { topic: 'A' }), rec('a3', { topic: 'A' })];
    const byId = new Map(recs.map((r) => [r.id, r]));
    const picked = pickDiverse(['a1', 'a2', 'a3'], byId, 3, 2);
    expect(picked.length).toBe(3); // A しか無い→3件返す
  });

  it('byId に無い id は無視する', () => {
    const recs = [rec('a1', { topic: 'A' })];
    const byId = new Map(recs.map((r) => [r.id, r]));
    const picked = pickDiverse(['missing', 'a1'], byId, 5, 2);
    expect(picked.map((r) => r.id)).toEqual(['a1']);
  });
});

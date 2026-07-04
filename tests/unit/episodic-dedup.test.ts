import { describe, it, expect } from 'vitest';
import { findNearDuplicate, mergeEpisodic } from '../../src/memory/remember/episodic-dedup';
import { DAILY_LIFE_CATEGORY } from '../../src/shared/constants';
import type { Embedder } from '../../src/shared/node/embedder';
import type { EpisodicMemory, EpisodicRecord } from '../../src/shared/types/memory';

// 書込時の近似重複マージ(P3)の純関数検証。埋め込みはフェイク注入(実モデル不要)。

function mem(p: Partial<EpisodicMemory>): EpisodicMemory {
  return { date: '2026-06-20T00:00:00+09:00', topic: 't', summary: 's', importance: 3, category: 'general', ...p };
}
function rec(id: string, p: Partial<EpisodicMemory>): EpisodicRecord {
  return { id, memory: mem(p) };
}

// フェイク埋め込み: 意味クラスタをベクトルの軸で表現(コード/天気/その他)。
function toVec(t: string): number[] {
  if (/コード|プログラ|詰まった/.test(t)) return [1, 0, 0];
  if (/天気|雨|晴/.test(t)) return [0, 1, 0];
  return [0, 0, 1];
}
const fake: Embedder = { embed: async (texts) => texts.map(toVec) };
const nowMs = Date.parse('2026-06-23T00:00:00+09:00');

describe('episodic-dedup — findNearDuplicate(P3)', () => {
  it('同カテゴリ・直近・意味が近い記録を近似重複として返す', async () => {
    const existing = [
      rec('2026/general/old.json', { summary: '今日もコードで詰まった', date: '2026-06-21T00:00:00+09:00' }),
    ];
    const dup = await findNearDuplicate(mem({ summary: 'またプログラムで詰まった' }), existing, fake, { nowMs });
    expect(dup?.id).toBe('2026/general/old.json');
  });

  it('意味が違えば重複としない', async () => {
    const existing = [rec('2026/general/old.json', { summary: '今日は雨だった', date: '2026-06-21T00:00:00+09:00' })];
    expect(await findNearDuplicate(mem({ summary: 'コードで詰まった' }), existing, fake, { nowMs })).toBeNull();
  });

  it('カテゴリが違えば対象外', async () => {
    const existing = [rec('2026/work/old.json', { summary: 'コードで詰まった', category: 'work', date: '2026-06-21T00:00:00+09:00' })];
    expect(await findNearDuplicate(mem({ summary: 'コードで詰まった', category: 'general' }), existing, fake, { nowMs })).toBeNull();
  });

  it('古すぎる記録(MAX_AGE 超)は対象外', async () => {
    const existing = [rec('2026/general/old.json', { summary: 'コードで詰まった', date: '2026-05-01T00:00:00+09:00' })];
    expect(await findNearDuplicate(mem({ summary: 'コードで詰まった' }), existing, fake, { nowMs })).toBeNull();
  });

  it('provenance が違えば対象外(self↔user を混ぜない)', async () => {
    const existing = [rec('2026/general/old.json', { summary: 'コードで詰まった', provenance: 'self', date: '2026-06-21T00:00:00+09:00' })];
    expect(
      await findNearDuplicate(mem({ summary: 'コードで詰まった', provenance: 'user' }), existing, fake, { nowMs }),
    ).toBeNull();
  });

  it('暮らしの断片(daily-life)はマージ対象から外す', async () => {
    const existing = [
      rec('2026/daily/old.json', { summary: 'コードで詰まった', category: DAILY_LIFE_CATEGORY, provenance: 'self', date: '2026-06-21T00:00:00+09:00' }),
    ];
    expect(
      await findNearDuplicate(mem({ summary: 'コードで詰まった', category: DAILY_LIFE_CATEGORY, provenance: 'self' }), existing, fake, { nowMs }),
    ).toBeNull();
  });

  it('supersede 済みは対象外', async () => {
    const existing = [
      rec('2026/general/old.json', { summary: 'コードで詰まった', supersededBy: 'x', date: '2026-06-21T00:00:00+09:00' }),
    ];
    expect(await findNearDuplicate(mem({ summary: 'コードで詰まった' }), existing, fake, { nowMs })).toBeNull();
  });

  it('埋め込み失敗時は null(新規保存に倒す)', async () => {
    const throwing: Embedder = {
      embed: async () => {
        throw new Error('no model');
      },
    };
    const existing = [rec('2026/general/old.json', { summary: 'コードで詰まった', date: '2026-06-21T00:00:00+09:00' })];
    expect(await findNearDuplicate(mem({ summary: 'コードで詰まった' }), existing, throwing, { nowMs })).toBeNull();
  });
});

describe('episodic-dedup — mergeEpisodic(P3)', () => {
  it('entities/tags を和集合し、importance は高い方、詳しい summary と最新 impression を採る', () => {
    const existing = mem({ summary: '短い', entities: ['田中'], tags: ['x'], importance: 2 });
    const incoming = mem({ summary: 'より詳しい要約', entities: ['鈴木'], tags: ['y'], importance: 4, impression: 'うれしい' });
    const patch = mergeEpisodic(existing, incoming);
    expect(patch.summary).toBe('より詳しい要約');
    expect([...(patch.entities ?? [])].sort()).toEqual(['田中', '鈴木'].sort());
    expect([...(patch.tags ?? [])].sort()).toEqual(['x', 'y'].sort());
    expect(patch.importance).toBe(4);
    expect(patch.impression).toBe('うれしい');
  });
});

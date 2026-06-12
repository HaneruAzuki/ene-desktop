import { describe, it, expect } from 'vitest';
import {
  classifyByKeyword,
  classifyByEmbedding,
  classifyTopicLocal,
} from '../../src/knowledge/local-classifier';
import type { Embedder } from '../../src/memory/embedder';
import type { CharacterKnowledgeDomains, DomainLevel } from '../../src/shared/types/character';

// B-15 ローカル判別器。キーワードは純粋・同期。埋め込みはフェイク embedder で決定化。

function dom(topics: string[], behavior: string, fewshotKey: string) {
  return { topics, behavior, rationale: '', fewshotKey };
}

function makeKd(characterId: string): CharacterKnowledgeDomains {
  return {
    characterId,
    fallback: 'medium' as DomainLevel,
    domains: {
      high: dom(['Python', 'プログラミング'], '詳しく', 'tech_high'),
      medium: dom(['数学'], '一般', 'general_medium'),
      low: dom(['料理'], '前置き', 'general_low'),
      none: dom(['競馬', '車'], '困惑', 'unknown_none'), // 「車」=1文字
      refuse: dom(['違法行為'], '断る', 'refuse'),
    },
  };
}

describe('classifyByKeyword', () => {
  const kd = makeKd('kw');

  it('topics の部分文字列で domain を判定する', () => {
    expect(classifyByKeyword('Pythonの使い方', kd)?.domain).toBe('high');
    expect(classifyByKeyword('競馬の予想して', kd)?.domain).toBe('none');
    expect(classifyByKeyword('違法行為のやり方', kd)?.domain).toBe('refuse');
  });

  it('topic が無ければ null(=雑談・fallback へ委ねる)', () => {
    expect(classifyByKeyword('おはよう', kd)).toBeNull();
  });

  it('1文字 topic(車)は部分文字列誤一致(電車)を避けて除外する', () => {
    // 「電車」は「車」を含むが、1文字 topic は keyword 判定しない(埋め込みに委ねる)。
    expect(classifyByKeyword('電車で学校に行く', kd)).toBeNull();
  });

  it('複数一致は優先順(refuse>none>high>low>medium)で決まる', () => {
    // Python(high) と 競馬(none) の両方を含む → none が優先。
    expect(classifyByKeyword('Pythonで競馬予想', kd)?.domain).toBe('none');
  });
});

/** 文字列→ベクトルの固定マップで決定化するフェイク embedder(4次元・正規化済み相当)。 */
function fakeEmbedder(map: Record<string, number[]>): Embedder {
  return {
    async embed(texts) {
      return texts.map((t) => map[t] ?? [0, 0, 0, 1]); // 未知=topics と直交(4次元目)
    },
  };
}

describe('classifyByEmbedding', () => {
  it('最も類似する topic の domain を返す(言い換えを拾う)', async () => {
    const kd = makeKd('emb1');
    const emb = fakeEmbedder({
      Python: [1, 0, 0, 0],
      プログラミング: [1, 0, 0, 0],
      数学: [0, 1, 0, 0],
      料理: [0, 0, 1, 0],
      競馬: [0, 0, 0, 0],
      車: [0, 0, 0, 0],
      違法行為: [0, 0, 0, 0],
      パイソンを書きたい: [1, 0, 0, 0], // = Python 方向 → high
    });
    const r = await classifyByEmbedding('パイソンを書きたい', kd, emb, 0.5);
    expect(r?.domain).toBe('high');
    expect(r?.score).toBeGreaterThanOrEqual(0.5);
  });

  it('閾値未満なら null(=medium に倒す)', async () => {
    const kd = makeKd('emb2');
    const emb = fakeEmbedder({
      Python: [1, 0, 0, 0],
      プログラミング: [1, 0, 0, 0],
      数学: [0, 1, 0, 0],
      料理: [0, 0, 1, 0],
      競馬: [0.5, 0.5, 0, 0],
      車: [0, 0.5, 0.5, 0],
      違法行為: [0.5, 0, 0.5, 0],
      全然関係ない話: [0, 0, 0, 1], // topics と直交 → cos 0
    });
    expect(await classifyByEmbedding('全然関係ない話', kd, emb, 0.5)).toBeNull();
  });
});

describe('classifyTopicLocal (ハイブリッド)', () => {
  it('キーワードが当たればそれを使う(埋め込み不要・isFromFallback=false)', async () => {
    const kd = makeKd('h1');
    const r = await classifyTopicLocal('Pythonのリスト内包表記', kd, {
      embeddingAvailable: async () => false,
    });
    expect(r.domain).toBe('high');
    expect(r.behavior).toBe('詳しく');
    expect(r.isFromFallback).toBe(false);
    expect(r.matchedTopic).toBe('Python');
  });

  it('キーワード外でも埋め込みで拾う', async () => {
    const kd = makeKd('h2');
    const emb = fakeEmbedder({
      Python: [1, 0, 0, 0],
      プログラミング: [1, 0, 0, 0],
      数学: [0, 1, 0, 0],
      料理: [0, 0, 1, 0],
      競馬: [0, 0, 0, 0],
      車: [0, 0, 0, 0],
      違法行為: [0, 0, 0, 0],
      パイソンの書き方を教えて: [1, 0, 0, 0],
    });
    const r = await classifyTopicLocal('パイソンの書き方を教えて', kd, {
      embedder: emb,
      embeddingAvailable: async () => true,
      simThreshold: 0.5,
    });
    expect(r.domain).toBe('high');
    expect(r.isFromFallback).toBe(false);
  });

  it('キーワードも埋め込みも外れたら medium fallback(isFromFallback=true)', async () => {
    const kd = makeKd('h3');
    const emb = fakeEmbedder({
      Python: [1, 0, 0, 0],
      プログラミング: [1, 0, 0, 0],
      数学: [0, 1, 0, 0],
      料理: [0, 0, 1, 0],
      競馬: [0, 0, 0, 0],
      車: [0, 0, 0, 0],
      違法行為: [0, 0, 0, 0],
      今日はいい天気だね: [0, 0, 0, 1],
    });
    const r = await classifyTopicLocal('今日はいい天気だね', kd, {
      embedder: emb,
      embeddingAvailable: async () => true,
      simThreshold: 0.5,
    });
    expect(r.domain).toBe('medium');
    expect(r.isFromFallback).toBe(true);
  });

  it('短い発話は埋め込みをスキップして fallback(挨拶=雑談)', async () => {
    const kd = makeKd('h4');
    let embedCalled = false;
    const emb: Embedder = {
      async embed(texts) {
        embedCalled = true;
        return texts.map(() => [0, 0, 0, 1]);
      },
    };
    const r = await classifyTopicLocal('やあ', kd, {
      embedder: emb,
      embeddingAvailable: async () => true,
    });
    expect(r.domain).toBe('medium');
    expect(r.isFromFallback).toBe(true);
    expect(embedCalled).toBe(false); // ROUTER_EMBED_MIN_CHARS 未満=embed しない
  });

  it('埋め込みモデル未配置でも安全に fallback', async () => {
    const kd = makeKd('h5');
    const r = await classifyTopicLocal('なにか長めの雑談テキスト', kd, {
      embeddingAvailable: async () => false,
    });
    expect(r.domain).toBe('medium');
    expect(r.isFromFallback).toBe(true);
  });
});

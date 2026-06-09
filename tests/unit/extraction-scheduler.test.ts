import { describe, it, expect, vi, beforeEach } from 'vitest';

// 短期記憶・抽出器をモックし、スケジューラの「直列化ロック＋バッチ＋flush」だけを検証する。
vi.mock('../../src/memory/short-term', () => ({
  getUnextractedEntries: vi.fn(),
}));
vi.mock('../../src/memory/extraction-trigger', () => ({
  extractFromShortTerm: vi.fn(),
}));

import { requestExtraction, flushExtraction } from '../../src/memory/extraction-scheduler';
import { getUnextractedEntries } from '../../src/memory/short-term';
import { extractFromShortTerm } from '../../src/memory/extraction-trigger';
import type { ShortTermEntry } from '../../src/shared/types/memory';
import type { LlmComplete } from '../../src/memory/extractor';

const getUnextracted = vi.mocked(getUnextractedEntries);
const extract = vi.mocked(extractFromShortTerm);
const complete: LlmComplete = async () => '';

/** 未抽出 n 件を表す配列(スケジューラは .length しか見ない)。 */
function unextracted(n: number): ShortTermEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    role: 'user' as const,
    text: 't',
    timestamp: `2026-06-01T10:00:${String(i).padStart(2, '0')}+09:00`,
    extracted: false,
  }));
}

/** 外から解決できる Promise(抽出の進行を制御する)。 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('extraction-scheduler (B-01 / B-02)', () => {
  it('未抽出が閾値未満なら抽出しない(バッチ化)', async () => {
    getUnextracted.mockResolvedValue(unextracted(3));
    await requestExtraction(complete);
    expect(extract).not.toHaveBeenCalled();
  });

  it('未抽出が閾値以上なら1回だけ overflow 抽出する', async () => {
    getUnextracted.mockResolvedValue(unextracted(8));
    extract.mockResolvedValue(undefined);
    await requestExtraction(complete);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith('overflow', complete);
  });

  it('走行中の要求は coalesce され、追走は1回だけ(直列化ロック)', async () => {
    getUnextracted.mockResolvedValue(unextracted(8)); // 常に閾値以上
    const gate = deferred();
    extract.mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);

    const p1 = requestExtraction(complete); // サイクル開始・1回目は gate 待ち
    requestExtraction(complete); // 走行中 → 追走を予約(pending)

    gate.resolve();
    await p1;

    // 1回目 ＋ 追走1回 = 2回で収束(無限ループにならない)
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('flushExtraction は走行中を待ってから shutdown 抽出する', async () => {
    getUnextracted.mockResolvedValue(unextracted(8));
    const gate = deferred();
    extract.mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);

    const p1 = requestExtraction(complete); // bg サイクル・1回目は gate 待ち
    let flushed = false;
    const pf = flushExtraction(complete).then(() => {
      flushed = true;
    });

    // 走行中の抽出が終わるまで flush は解決しない。
    await Promise.resolve();
    expect(flushed).toBe(false);

    gate.resolve();
    await p1;
    await pf;

    expect(flushed).toBe(true);
    expect(extract).toHaveBeenCalledWith('shutdown', complete);
  });
});

import { describe, it, expect } from 'vitest';
import { selectOpenLoops, type OpenLoopState } from '../../src/memory/open-loops';
import type { EpisodicRecord } from '../../src/shared/types/memory';

// §1.5: 気にかけ(open-loops)の開示ゲート。親密度(stage)より深い気にかけは自分から持ち出さない。

function rec(id: string, disclosureLevel: number): EpisodicRecord {
  return {
    id,
    memory: {
      date: '2026-06-01T10:00:00+09:00',
      topic: 't',
      summary: 's',
      importance: 2,
      category: 'daily-life',
      disclosureLevel,
      openLoop: { kind: 'question', note: `note-${id}` },
    },
  };
}

const STATE: OpenLoopState = { surfaced: {} };
const NOW_MS = Date.parse('2026-06-02T10:00:00+09:00');
const NOW_ISO = '2026-06-02T10:00:00+09:00';

describe('selectOpenLoops 開示ゲート(§1.5)', () => {
  it('深い気にかけ(disclosure > stage)は出さない', () => {
    const sel = selectOpenLoops([rec('a', 1), rec('b', 4)], STATE, NOW_MS, NOW_ISO, 2);
    expect(sel.notes).toContain('note-a');
    expect(sel.notes).not.toContain('note-b');
  });

  it('親密になれば(stage 上昇)深い気にかけも出る', () => {
    const sel = selectOpenLoops([rec('b', 4)], STATE, NOW_MS, NOW_ISO, 5);
    expect(sel.notes).toContain('note-b');
  });

  it('stage 未指定は全開示(後方互換)', () => {
    const sel = selectOpenLoops([rec('b', 5)], STATE, NOW_MS, NOW_ISO);
    expect(sel.notes).toContain('note-b');
  });
});

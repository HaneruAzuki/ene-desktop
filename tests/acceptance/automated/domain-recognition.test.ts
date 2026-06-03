import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';

// 成功基準4(知らないことは「知らない」と返す)の機構検証。
// 実際の「知らない」応答は実 Claude + 人間判定(手動プロトコル)で確認する。
// ここでは「ENE の人格プロンプトに、知らない領域(パチンコ等)と
// 『知らないと返す』指示が確実に組み込まれている」ことを保証する。
const h = vi.hoisted(() => ({ appPath: process.cwd() }));
vi.mock('electron', () => ({
  app: {
    getAppPath: (): string => h.appPath,
    isPackaged: false,
    getPath: (): string => os.tmpdir(),
  },
}));

import { loadCharacterProfile } from '../../../src/character/loader';
import { buildSystemPrompt } from '../../../src/character/system-prompt-builder';

beforeEach(() => {
  h.appPath = process.cwd(); // 実際の characters/ene を読む
});

describe('受入: 知らない領域の認識(成功基準4 の機構)', () => {
  it('ENE の人格プロンプトに「知らない領域(パチンコ)」と「知らないと返す」指示が含まれる', async () => {
    const p = await loadCharacterProfile('ene');
    const sys = buildSystemPrompt(p.identity, p.background, p.knowledgeDomains);
    expect(sys).toContain('パチンコ');
    expect(sys).toMatch(/知らない|わからない/);
  });

  it('AI 自称防止が人格プロンプトに明示される(成功基準8 の機構の一部)', async () => {
    const p = await loadCharacterProfile('ene');
    const sys = buildSystemPrompt(p.identity, p.background, p.knowledgeDomains);
    const neverWord = p.identity.selfRecognition.neverCallsSelf[0] ?? 'AI';
    expect(sys).toContain(neverWord);
    expect(sys).toContain('絶対に');
  });

  it('ENE の知識ドメインは none に賭博を、high に Python を持つ(キャラ整合)', async () => {
    const p = await loadCharacterProfile('ene');
    expect(p.knowledgeDomains.domains.none.topics).toContain('パチンコ');
    expect(p.knowledgeDomains.domains.high.topics).toContain('Python');
  });
});

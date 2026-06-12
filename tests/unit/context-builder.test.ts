import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// paths をモック: active-character.json は tmp、キャラ定義は実物(cwd 直下の {id}/)を使う。
const h = vi.hoisted(() => ({ acPath: '', dir: '' }));
vi.mock('../../src/shared/node/paths', () => ({
  getActiveCharacterPath: (): string => h.acPath,
  getCharacterDir: (id: string): string => `${process.cwd()}/${id}`,
  getCurrentStatePath: (id: string): string => `${process.cwd()}/${id}/current-state.json`,
  setActiveCharacterId: vi.fn(),
}));

import { buildCharacterContext } from '../../src/character/context-builder';

beforeEach(async () => {
  h.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-ctx-'));
  h.acPath = path.join(h.dir, 'active-character.json');
});
afterEach(async () => {
  await fs.rm(h.dir, { recursive: true, force: true });
});

describe('context-builder (設計書 §3.1)', () => {
  it('完全な CharacterContext を構築する', async () => {
    const ctx = await buildCharacterContext();
    expect(ctx.identity.name).toBe('魚川トリミ');
    expect(ctx.knowledgeDomains.fallback).toBe('medium');
    expect(ctx.fewshot.examples.tech_high.length).toBeGreaterThan(0);
    expect(ctx.portraitPath).toContain('portrait.png');
    // systemPrompt に AI自称防止(neverCallsSelf)が含まれる
    expect(ctx.systemPrompt).toContain('アシスタント');
    // 今日(環境上 2026-06-01)は ENE の誕生日(8/15)より前 → null
    expect(ctx.birthdayHint).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// app.getAppPath() を制御して characters/ のルートを差し替える。
const h = vi.hoisted(() => ({ appPath: process.cwd() }));
vi.mock('electron', () => ({
  app: {
    getAppPath: (): string => h.appPath,
    isPackaged: false,
    getPath: (): string => os.tmpdir(),
  },
}));

import { loadCharacterProfile } from '../../src/character/loader';

beforeEach(() => {
  h.appPath = process.cwd(); // 既定: 実際の characters/ene を読む
});

describe('character loader (設計書 §3.1)', () => {
  it('loadCharacterProfile("ene") で別添A 相当の内容がロードできる', async () => {
    const p = await loadCharacterProfile('ene');
    expect(p.identity.characterId).toBe('ene');
    expect(p.identity.name).toBe('魚川トリミ');
    expect(p.knowledgeDomains.fallback).toBe('medium');
    expect(p.fewshot.examples.tech_high.length).toBeGreaterThan(0);
    expect(p.portraitPath).toContain(path.join('characters', 'ene', 'portrait.png'));
  });

  it('ファイルが欠けていれば例外を throw する', async () => {
    h.appPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-empty-'));
    await expect(loadCharacterProfile('ene')).rejects.toThrow();
  });

  it('characterId 不一致で例外を throw する', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-mismatch-'));
    const dir = path.join(base, 'characters', 'ene');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'identity.json'),
      JSON.stringify({
        characterId: 'wrong',
        name: 'X',
        ageAppearance: '',
        gender: '',
        personality: { core: '', tone: '', firstPerson: '私', speechEndings: [] },
        selfRecognition: { callsSelf: '', neverCallsSelf: [], aiQuestionHandling: '' },
      }),
    );
    await fs.writeFile(
      path.join(dir, 'background.json'),
      JSON.stringify({
        characterId: 'ene',
        birthplace: '',
        family: {},
        education: '',
        hobbies: [],
        dislikes: [],
        lifeExperience: { exposedTo: [], notExposedTo: [] },
      }),
    );
    await fs.writeFile(
      path.join(dir, 'knowledge_domains.json'),
      JSON.stringify({ characterId: 'ene', domains: {}, fallback: 'medium' }),
    );
    await fs.writeFile(
      path.join(dir, 'fewshot.json'),
      JSON.stringify({ characterId: 'ene', examples: {} }),
    );
    h.appPath = base;
    await expect(loadCharacterProfile('ene')).rejects.toThrow(/characterId/);
  });
});

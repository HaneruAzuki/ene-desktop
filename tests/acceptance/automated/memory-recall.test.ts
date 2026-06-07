import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 成功基準5(記憶を覚えている)の機構検証。
// 「太郎」という応答そのものは実 Claude + 人間判定(手動プロトコル)で確認する。
// ここでは「長期記憶に保存 → 新セッションで読み直し → 統合プロンプトに反映」までを保証する。
//
// paths をモックして記憶ファイルを一時ディレクトリへ隔離する(実 data/ を汚さない)。
const h = vi.hoisted(() => ({ base: '' }));
vi.mock('../../../src/storage/paths', () => ({
  getSemanticPath: (): string => `${h.base}/semantic.json`,
  getShortTermPath: (): string => `${h.base}/short-term.json`,
  getMemoryDir: (): string => h.base,
  getEpisodicDir: (year: number, category: string): string =>
    `${h.base}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.base}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.base}/index/vectors.json`,
  getModelsDir: (): string => `${h.base}/models`,
}));

import { updateSemantic } from '../../../src/memory/semantic';
import { buildMemoryContext } from '../../../src/memory/context-builder';
import { buildPrompt } from '../../../src/conversation/prompt-builder';
import { makeCharContext, makeRouterResult, systemText } from '../../unit/fixtures';

beforeEach(async () => {
  h.base = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-acc-mem-'));
});
afterEach(async () => {
  await fs.rm(h.base, { recursive: true, force: true });
});

describe('受入: セッションを跨いだ記憶(成功基準5 の機構)', () => {
  it('セッション1で記憶した名前が、新セッションの記憶コンテキスト→プロンプトに反映される', async () => {
    // セッション1:「私の名前は太郎です」の抽出結果に相当する長期記憶更新
    await updateSemantic({ userName: '太郎' });

    // セッション2(新規プロセス相当):記憶を読み直す
    const mc = await buildMemoryContext({ text: '私の名前覚えてる?', limit: 5 });
    expect(mc.semantic.userName).toBe('太郎');

    // 統合プロンプトの長期記憶セクションに名前が載る(= ENE が参照できる)
    const prompt = buildPrompt(makeCharContext(), mc, makeRouterResult(), '私の名前覚えてる?');
    expect(systemText(prompt)).toContain('相手の名前: 太郎');
  });

  it('好み(preferences)も長期記憶に蓄積され、プロンプトへ反映される', async () => {
    await updateSemantic({ userName: '太郎', preferences: { 好きな食べ物: 'ラーメン' } });
    const mc = await buildMemoryContext({ text: 'なんか食べたい', limit: 5 });
    const prompt = buildPrompt(makeCharContext(), mc, makeRouterResult(), 'なんか食べたい');
    expect(systemText(prompt)).toContain('ラーメン');
  });
});

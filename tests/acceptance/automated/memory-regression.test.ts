import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// =============================================================================
// 記憶レイヤー横断 回帰ハーネス(決定論・API不要・npm test に常駐)。
//
// 目的:記憶まわりを改修したとき、「過去の記憶の記録がちゃんと動くか」を抜け漏れなく自動検証する。
// 方式:記憶ファイルを実際に書く → buildConversationMemory(本番の会話経路)→ buildPrompt で、
//      「記憶の状態 → プロンプトに正しく注入/除外されるか」を確認する。LLM を呼ばない=無料・決定論。
//
// カバーする機構(各 it が1機構):想起(語彙索引)/ 非破壊更新(supersede 除外)/ 開示ゲーティング
// (familiarityStage)/ 長期記憶(semantic 全フィールド)/ 短期記憶 / 想起件数上限。
// 存在感機能(いま/気にかけ/まだ知らないこと/誕生日/名前読み)は presence-scenarios.test.ts、
// provenance 分離・ルビ・セクション整形は prompt-builder.test.ts、心(mood)・RRF・忘却・corrections は
// 各ユニットテスト。全体の対応は docs/test-scenarios-presence.md を参照。
// =============================================================================

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../../src/shared/node/paths', () => ({
  getSemanticPath: (): string => `${h.memDir}/semantic.json`,
  getShortTermPath: (): string => `${h.memDir}/short-term.json`,
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string => `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
  getModelsDir: (): string => `${h.memDir}/models`, // 未配置=ベクトル想起スキップ(語彙のみ・決定論)
  getLifeMemoryPath: (id: string): string => `${h.memDir}/${id}/life-memory.json`,
  getOpenLoopStatePath: (): string => `${h.memDir}/open-loop-state.json`,
  getActiveCharacterPath: (): string => `${h.memDir}/active-character.json`,
  getActiveCharacterId: (): string => 'ene',
}));

import { buildConversationMemory } from '../../../src/memory/context-builder';
import { buildPrompt } from '../../../src/conversation/prompt-builder';
import { saveEpisodic } from '../../../src/memory/episodic';
import { rebuildInvertedIndex } from '../../../src/memory/index-inverted';
import { updateSemantic } from '../../../src/memory/semantic';
import { appendShortTerm } from '../../../src/memory/short-term';
import { saveActiveCharacter } from '../../../src/character/active-character';
import { makeCharContext, makeRouterResult, systemText, lastUserText } from '../../unit/fixtures';
import { nowLocalIso } from '../../../src/shared/datetime';
import { DAY_MS } from '../../../src/shared/constants';
import type { EpisodicMemory } from '../../../src/shared/types/memory';
import type { ActiveCharacter, RelationshipFacts } from '../../../src/shared/types/character';

function isoDaysAgo(days: number): string {
  const now = nowLocalIso();
  const base = new Date(Date.now() - days * DAY_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ymd = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  return `${ymd}${now.slice(10)}`;
}

/** 関係の事実を書く(親しさ段階を制御する)。fresh=stage1 / deep=stage4以上。 */
async function writeRelationship(rel: RelationshipFacts | undefined): Promise<void> {
  const active: ActiveCharacter = {
    version: 1,
    characterId: 'ene',
    selectedAt: '2026-01-01T00:00:00+09:00',
    birthdayHistory: [],
    firstLaunchCompleted: true,
    ...(rel ? { relationship: rel } : {}),
  };
  await saveActiveCharacter(active);
}

const FRESH: RelationshipFacts = {
  firstMetAt: isoDaysAgo(0),
  lastConversationDate: isoDaysAgo(0).slice(0, 10),
  distinctConversationDays: 1,
  totalTurns: 2,
};
const DEEP: RelationshipFacts = {
  firstMetAt: isoDaysAgo(200),
  lastConversationDate: isoDaysAgo(1).slice(0, 10),
  distinctConversationDays: 50,
  totalTurns: 400,
};

/** 既定の user episodic を作る(必要分だけ上書き)。 */
function userMemory(over: Partial<EpisodicMemory>): EpisodicMemory {
  return {
    date: isoDaysAgo(2),
    topic: 't',
    summary: 's',
    tags: [],
    entities: [],
    importance: 3,
    category: 'general',
    provenance: 'user',
    valence: 0,
    disclosureLevel: 1,
    ...over,
  };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-memreg-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('記憶回帰: 想起(語彙索引)', () => {
  it('クエリのキーワードに一致する記憶が、より高importanceの無関係記憶を抑えて想起される', async () => {
    await writeRelationship(FRESH);
    // A=一致(低importance・古い)/ B=無関係(高importance・新しい=backfill ならこちらが勝つ)。
    await saveEpisodic(userMemory({ summary: 'ラーメンの話をした', tags: ['ラーメン'], importance: 1, date: isoDaysAgo(10) }));
    await saveEpisodic(userMemory({ summary: '天気の話をした', tags: ['天気'], importance: 5, date: isoDaysAgo(1) }));
    await rebuildInvertedIndex();

    const mc = await buildConversationMemory({ text: 'ラーメン食べたい', limit: 1 });
    // 語彙一致が効いていれば A(ラーメン)が出る。効いていなければ backfill で B(天気・高importance)になる。
    expect(mc.relevantEpisodic.some((m) => m.summary.includes('ラーメン'))).toBe(true);
    expect(lastUserText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'ラーメン食べたい'))).toContain('ラーメン');
  });
});

describe('記憶回帰: 非破壊更新(supersede)', () => {
  it('supersededBy が付いた古い記憶は想起されない', async () => {
    await writeRelationship(FRESH);
    await saveEpisodic(userMemory({ summary: '古い情報(置換済み)', tags: ['情報'], supersededBy: '2026/general/dummy.json' }));
    await saveEpisodic(userMemory({ summary: '新しい情報', tags: ['情報'] }));
    await rebuildInvertedIndex();

    const mc = await buildConversationMemory({ text: '情報', limit: 5 });
    const summaries = mc.relevantEpisodic.map((m) => m.summary);
    expect(summaries).not.toContain('古い情報(置換済み)');
    expect(summaries).toContain('新しい情報');
  });
});

describe('記憶回帰: 開示ゲーティング(親しさ段階)', () => {
  it('高い開示段階の記憶は、親しくないと想起されず、親しくなると想起される', async () => {
    const deep = userMemory({ summary: '打ち明けた深い秘密', tags: ['秘密'], disclosureLevel: 4, importance: 5 });

    // stage 1(初対面)→ disclosureLevel 4 はゲートで除外。
    await writeRelationship(FRESH);
    await saveEpisodic(deep);
    await rebuildInvertedIndex();
    const low = await buildConversationMemory({ text: '秘密', limit: 5 });
    expect(low.relevantEpisodic.some((m) => m.summary.includes('深い秘密'))).toBe(false);

    // stage 4(十分親しい)→ 同じ記憶が想起される。
    await writeRelationship(DEEP);
    const high = await buildConversationMemory({ text: '秘密', limit: 5 });
    expect(high.relevantEpisodic.some((m) => m.summary.includes('深い秘密'))).toBe(true);
  });
});

describe('記憶回帰: 長期記憶(semantic 全フィールド)', () => {
  it('userName/preferences/longTermGoals/personality/extra がすべてプロンプトに注入される', async () => {
    await writeRelationship(FRESH);
    await updateSemantic({
      userName: '太郎',
      preferences: { 好きな言語: 'Python' },
      longTermGoals: ['難関資格の取得'],
      personality: ['几帳面', '夜更かし'],
      extra: { 飼い猫: 'ミケ' },
    });
    const mc = await buildConversationMemory({ text: 'やあ', limit: 5 });
    const sys = systemText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'やあ'));
    expect(sys).toContain('太郎');
    expect(sys).toContain('Python');
    expect(sys).toContain('難関資格の取得');
    expect(sys).toContain('几帳面');
    expect(sys).toContain('ミケ');
  });
});

describe('記憶回帰: 短期記憶', () => {
  it('直近の会話履歴がプロンプトの messages に入る', async () => {
    await writeRelationship(FRESH);
    await appendShortTerm({ role: 'user', text: '昨日の続きなんだけど', timestamp: nowLocalIso(), extracted: false });
    await appendShortTerm({ role: 'assistant', text: 'うん、なに?', timestamp: nowLocalIso(), extracted: false });

    const mc = await buildConversationMemory({ text: 'それでね', limit: 5 });
    expect(mc.shortTerm.length).toBe(2);
    const p = buildPrompt(makeCharContext(), mc, makeRouterResult(), 'それでね');
    expect(p.messages.some((m) => m.content.includes('昨日の続きなんだけど'))).toBe(true);
  });
});

describe('記憶回帰: 想起件数の上限', () => {
  it('limit を超えて想起しない', async () => {
    await writeRelationship(FRESH);
    for (let i = 0; i < 6; i++) {
      await saveEpisodic(userMemory({ summary: `記憶${i}`, tags: ['共通'], date: isoDaysAgo(i + 1) }));
    }
    await rebuildInvertedIndex();
    const mc = await buildConversationMemory({ text: '共通', limit: 3 });
    expect(mc.relevantEpisodic.length).toBeLessThanOrEqual(3);
  });
});

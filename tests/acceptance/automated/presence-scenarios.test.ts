import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

// =============================================================================
// 存在感の改修(N-PRES-*)エンドツーエンド回帰ハーネス。
//
// 目的:「記憶の状態(入力)→ プロンプトに注入される文脈(出力)」を、記憶ファイルを実際に書いて検証する。
// 記憶まわりの調整で壊れやすい「気にかけ/まだ知らないこと/いま/誕生日/名前の読み」の配線を、
// 時間を調整した記憶も使って網羅的に固定する。各機能とユースケースの対応は
// docs/test-scenarios-presence.md(人間可読の対応表)を参照。
//
// 方式:paths をテンポラリへ差し替え(他のメモリテストと同じ)→ 記憶を書く →
//      buildConversationMemory で moment を計算 → buildPrompt で注入文面を確認。
//      埋め込みモデルは未配置=ベクトル想起はスキップ(語彙のみ・決定論)。
// =============================================================================

const h = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../../../src/shared/node/paths', () => ({
  getSemanticPath: (): string => `${h.memDir}/semantic.json`,
  getShortTermPath: (): string => `${h.memDir}/short-term.json`,
  getMemoryDir: (): string => h.memDir,
  getEpisodicDir: (year: number, category: string): string => `${h.memDir}/episodic/${year}/${category}`,
  getInvertedIndexPath: (): string => `${h.memDir}/index/inverted.json`,
  getVectorIndexPath: (): string => `${h.memDir}/index/vectors.json`,
  getModelsDir: (): string => `${h.memDir}/models`, // 未配置=ベクトル想起スキップ
  getLifeMemoryPath: (id: string): string => `${h.memDir}/${id}/life-memory.json`,
  getOpenLoopStatePath: (): string => `${h.memDir}/open-loop-state.json`,
  getActiveCharacterPath: (): string => `${h.memDir}/active-character.json`,
  getActiveCharacterId: (): string => 'ene',
}));

import { buildConversationMemory } from '../../../src/memory/context-builder';
import { buildPrompt } from '../../../src/conversation/prompt-builder';
import { saveEpisodic } from '../../../src/memory/episodic';
import { updateSemantic } from '../../../src/memory/semantic';
import { saveActiveCharacter } from '../../../src/character/active-character';
import { makeCharContext, makeRouterResult, systemText, lastUserText } from '../../unit/fixtures';
import { nowLocalIso } from '../../../src/shared/datetime';
import { DAY_MS } from '../../../src/shared/constants';
import type { ActiveCharacter, RelationshipFacts } from '../../../src/shared/types/character';

/** 今日から daysAgo 日前のローカル ISO(TZ込み)。 */
function isoDaysAgo(days: number): string {
  const now = nowLocalIso();
  // 日付部分だけ差し引く(時刻はそのまま=lookback/elapsed の判定に十分)。
  const base = new Date(Date.now() - days * DAY_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ymd = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  return `${ymd}${now.slice(10)}`; // 元の時刻+TZ を流用
}

function ymdDaysAgo(days: number): string {
  return isoDaysAgo(days).slice(0, 10);
}

async function writeActive(relationship: RelationshipFacts | undefined): Promise<void> {
  const active: ActiveCharacter = {
    version: 1,
    characterId: 'ene',
    selectedAt: '2026-01-01T00:00:00+09:00',
    birthdayHistory: [],
    firstLaunchCompleted: true,
    ...(relationship ? { relationship } : {}),
  };
  await saveActiveCharacter(active);
}

/** stage 1 相当(初対面〜浅い)の関係。lastConversationDate で経過を制御。 */
function freshRelationship(lastDaysAgo: number): RelationshipFacts {
  return {
    firstMetAt: isoDaysAgo(lastDaysAgo),
    lastConversationDate: ymdDaysAgo(lastDaysAgo),
    distinctConversationDays: 1,
    totalTurns: 2,
  };
}

beforeEach(async () => {
  h.memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ene-presence-'));
});
afterEach(async () => {
  await fs.rm(h.memDir, { recursive: true, force: true });
});

describe('存在感 E2E: いま(P1)', () => {
  it('現在時刻と前回会話からの経過がプロンプトに入る', async () => {
    await writeActive(freshRelationship(3));
    const mc = await buildConversationMemory({ text: 'こんばんは', limit: 5 });
    expect(mc.moment?.nowIso).toBeTruthy();
    expect(mc.moment?.elapsedLabel).toBe('3日ぶり');
    const text = lastUserText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'こんばんは'));
    expect(text).toContain('# いま');
    expect(text).toContain('3日ぶり');
  });
});

describe('存在感 E2E: 気にかけエンジン(P4)', () => {
  it('未解決の気にかけ(時間調整した記憶)が注入される', async () => {
    await writeActive(freshRelationship(1));
    // 2日前の「面接の結果待ち」(未解決)。lookback 内・クールダウン無し → 注入される。
    await saveEpisodic({
      date: isoDaysAgo(2),
      topic: '面接',
      summary: '相手は面接を受けた。結果はまだ聞いていない。',
      importance: 4,
      category: 'work',
      provenance: 'user',
      openLoop: { kind: 'user-event', note: '相手は面接を受けた。結果をまだ聞いていない' },
    });
    const mc = await buildConversationMemory({ text: '今日もよろしく', limit: 5 });
    expect(mc.moment?.openLoops).toContain('相手は面接を受けた。結果をまだ聞いていない');
    const text = lastUserText(buildPrompt(makeCharContext(), mc, makeRouterResult(), '今日もよろしく'));
    expect(text).toContain('気にかけていること');
    expect(text).toContain('面接');
  });

  it('解決済みの気にかけは注入されない', async () => {
    await writeActive(freshRelationship(1));
    await saveEpisodic({
      date: isoDaysAgo(2),
      topic: '面接',
      summary: '面接を受けて受かった。',
      importance: 4,
      category: 'work',
      provenance: 'user',
      openLoop: { kind: 'user-event', note: '面接の結果待ち', resolvedAt: isoDaysAgo(1) },
    });
    const mc = await buildConversationMemory({ text: 'やあ', limit: 5 });
    expect(mc.moment?.openLoops ?? []).not.toContain('面接の結果待ち');
  });
});

describe('存在感 E2E: まだ知らないこと(P5)', () => {
  it('名前を知らなければ「相手の名前」を聞くギャップが出る', async () => {
    await writeActive(freshRelationship(1)); // stage 1
    const mc = await buildConversationMemory({ text: 'はじめまして', limit: 5 });
    expect(mc.moment?.knowledgeGaps).toContain('相手の名前');
    const text = lastUserText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'はじめまして'));
    expect(text).toContain('まだ知らないこと');
  });

  it('名前を知っていれば名前は聞かない', async () => {
    await writeActive(freshRelationship(1));
    await updateSemantic({ userName: '優希' });
    const mc = await buildConversationMemory({ text: 'やあ', limit: 5 });
    expect(mc.moment?.knowledgeGaps ?? []).not.toContain('相手の名前');
  });
});

describe('存在感 E2E: 名前の読み(P5)', () => {
  it('名前と読みがあればルビ付きで semantic に出る', async () => {
    await writeActive(freshRelationship(1));
    await updateSemantic({ userName: '優希', userNameReading: 'ゆうき' });
    const mc = await buildConversationMemory({ text: 'やあ', limit: 5 });
    const sys = systemText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'やあ'));
    expect(sys).toContain('優希《ゆうき》');
  });
});

describe('存在感 E2E: 相手の誕生日(P5)', () => {
  it('今日が相手の誕生日なら祝うヒントが出る', async () => {
    await writeActive(freshRelationship(1));
    const today = nowLocalIso();
    const month = Number(today.slice(5, 7));
    const day = Number(today.slice(8, 10));
    await updateSemantic({ userBirthday: { month, day } });
    const mc = await buildConversationMemory({ text: 'おはよう', limit: 5 });
    expect(mc.moment?.userBirthdayToday).toBe(true);
    const text = lastUserText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'おはよう'));
    expect(text).toContain('今日は相手の誕生日');
  });
});

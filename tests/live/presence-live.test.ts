import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSystemPrompt } from '../../src/character/system-prompt-builder';
import { chat } from '../../src/conversation/client';
import { makeRouterResult, makeMemoryContext } from '../unit/fixtures';
import type { CharacterContext } from '../../src/shared/types/character';
import type { MemoryContext } from '../../src/shared/types/memory';

// =============================================================================
// 存在感の改修(N-PRES-*)実API behavior ハーネス。
//
// 「裏で文章生成器が適当に出力している」と露呈する応答を、実際の Claude API で確認する。
// 自動 npm test では**実行しない**(skip)。実行するには API キーと明示フラグが要る(PowerShell):
//
//   $env:ENE_LIVE_TEST = "1"
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."
//   npx vitest run tests/live --reporter verbose
//   (あるいは  .\scripts\presence-live-check.ps1  ← キーを先に set しておく)
//
// 入力は tests/live/scenarios.json(あなたが編集可能)。各 userText を実 API に流し、
// トリミの回答を **presence-live-results.md** に書き出す(コンソールにも出力)。
// このファイルを Claude/あなたが読んで「想定どおりの言葉が入っているか(OK/NG)」を判定する
// (成功基準8 は人間判定・CLAUDE §9.2)。自動アサートは「応答が成立しているか」のみ。
// 機能とシナリオの対応は docs/test-scenarios-presence.md。
// =============================================================================

const LIVE = process.env.ENE_LIVE_TEST === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

interface Scenario {
  label: string;
  userText: string;
  memory?: Partial<MemoryContext>;
  expect?: string;
}

const RESULTS_PATH = path.join(process.cwd(), 'presence-live-results.md');

function loadScenarios(): Scenario[] {
  const file = path.join(process.cwd(), 'tests', 'live', 'scenarios.json');
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { scenarios: Scenario[] };
  return parsed.scenarios;
}

/** ene/*.json を直接読み、Electron(paths)に依存せず charContext を組む。 */
function loadCharContext(): CharacterContext {
  const dir = path.join(process.cwd(), 'ene');
  const read = (f: string): unknown => JSON.parse(readFileSync(path.join(dir, f), 'utf-8'));
  const identity = read('identity.json') as CharacterContext['identity'];
  const background = read('background.json') as CharacterContext['background'];
  const knowledgeDomains = read('knowledge_domains.json') as CharacterContext['knowledgeDomains'];
  const fewshot = read('fewshot.json') as CharacterContext['fewshot'];
  const systemPrompt = buildSystemPrompt(identity, background, knowledgeDomains, null);
  return { identity, background, knowledgeDomains, fewshot, portraitPath: '', systemPrompt, birthdayHint: null, currentState: null };
}

const results: string[] = [];

describe.skipIf(!LIVE)('存在感 実API behavior(目視確認・ENE_LIVE_TEST=1 のとき)', () => {
  const scenarios = LIVE ? loadScenarios() : [];
  const cc = LIVE ? loadCharContext() : null;
  const apiKey = process.env.ANTHROPIC_API_KEY as string;

  beforeAll(() => {
    results.push(`# 実API behavior 結果\n\n生成: ${new Date().toISOString()}\nモデル既定: Sonnet(chat 経由)\n`);
  });

  afterAll(() => {
    writeFileSync(RESULTS_PATH, results.join('\n'), 'utf-8');
    // パスを最後に出して、どこを読めばよいか分かるようにする。
    console.log(`\n=== 回答を ${RESULTS_PATH} に書き出しました(Claude/あなたが OK/NG を判定) ===\n`);
  });

  for (const sc of scenarios) {
    it(sc.label, async () => {
      const mc = makeMemoryContext(sc.memory ?? {});
      const res = await chat(sc.userText, cc as CharacterContext, mc, makeRouterResult({ behavior: '相手の話に自然に応じる' }), apiKey);
      const answer = res.message;
      const block = [
        `## ${sc.label}`,
        `- 入力: ${sc.userText}`,
        sc.expect ? `- 期待: ${sc.expect}` : '',
        `- トリミの回答: ${answer}`,
        '',
      ].filter((s) => s.length > 0).join('\n');
      results.push(block);
      console.log(`\n[${sc.label}]\nQ: ${sc.userText}\nA: ${answer}\n`);
      // 自動判定は「応答が成立しているか」だけ(中身の妥当性は人間判定)。
      expect(answer.length).toBeGreaterThan(0);
    }, 30000);
  }
});

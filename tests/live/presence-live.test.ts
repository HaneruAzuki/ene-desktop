import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSystemPrompt } from '../../src/character/system-prompt-builder';
import { chat } from '../../src/conversation/client';
import { detectAiSelfReference } from '../../src/conversation/ai-self-check';
import { makeRouterResult, makeMemoryContext } from '../unit/fixtures';
import type { CharacterContext } from '../../src/shared/types/character';
import type { MemoryContext } from '../../src/shared/types/memory';

// =============================================================================
// 存在感の改修(N-PRES-*)実API behavior ハーネス。
//
// 『APIでしか分からない挙動』(モデルが規範に従うか/作話しないか/AI自称しないか)を実 Claude API で確認する。
// 自動 npm test では**実行しない**(skip)。実行するには API キーと明示フラグが要る(PowerShell):
//
//   $env:ENE_LIVE_TEST = "1"
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."
//   npx vitest run tests/live --reporter verbose
//
// 入力は tests/live/scenarios.json(編集可・1シナリオ=1コール・Tier0+fewshotはキャッシュで初回のみ課金)。
// 各回答を **presence-live-results.md** に「入力/記憶/期待(PASS)/危険信号(FAIL)/自動チェック/回答」で書き出す。
// 判定の二段構え:
//   - 自動(機械): 空でない / **AI自称検知(detectAiSelfReference)=ハードFAIL** / 回避語ヒット=フラグ。
//   - Claude 判定: 上記で落ちなかったものを、期待/危険信号と回答を突き合わせて OK/NG(成功基準8 は人間/Claude 判定)。
// このファイルを Claude に見せれば、シナリオごとの OK/NG を出せる。対応表は docs/test-scenarios-presence.md。
// =============================================================================

const LIVE = process.env.ENE_LIVE_TEST === '1' && Boolean(process.env.ANTHROPIC_API_KEY);
const RESULTS_PATH = path.join(process.cwd(), 'presence-live-results.md');

interface Scenario {
  label: string;
  userText: string;
  memory?: Partial<MemoryContext>;
  expect?: string;
  redFlags?: string;
  autoAvoid?: string[];
}

function loadScenarios(): Scenario[] {
  const file = path.join(process.cwd(), 'tests', 'live', 'scenarios.json');
  return (JSON.parse(readFileSync(file, 'utf-8')) as { scenarios: Scenario[] }).scenarios;
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

/** 記憶状態を1行で要約(ログ用)。 */
function summarizeMemory(m: Partial<MemoryContext> | undefined): string {
  if (!m) return '(なし)';
  const parts: string[] = [];
  if (m.semantic) parts.push(`semantic{${Object.keys(m.semantic).filter((k) => k !== 'version').join(',')}}`);
  if (m.moment) parts.push(`moment{${Object.keys(m.moment).filter((k) => k !== 'nowIso' && k !== 'timeOfDay').join(',')}}`);
  if (m.relevantEpisodic?.length) {
    const self = m.relevantEpisodic.filter((e) => e.provenance === 'self').length;
    parts.push(`episodic[self=${self},user=${m.relevantEpisodic.length - self}]`);
  }
  if (m.shortTerm?.length) parts.push(`shortTerm[${m.shortTerm.length}]`);
  return parts.length ? parts.join(' ') : '(空=記憶なし)';
}

const results: string[] = [];
let autoFails = 0;

describe.skipIf(!LIVE)('存在感 実API behavior(ENE_LIVE_TEST=1 のとき)', () => {
  const scenarios = LIVE ? loadScenarios() : [];
  const cc = LIVE ? loadCharContext() : null;
  const apiKey = process.env.ANTHROPIC_API_KEY as string;

  beforeAll(() => {
    results.push(`# 実API behavior 結果\n\n生成: ${new Date().toISOString()} / モデル: Sonnet(chat 経由) / シナリオ: ${scenarios.length}\n`);
  });

  afterAll(() => {
    const header = `> 自動FAIL(AI自称検知): ${autoFails} 件 / 残りは Claude が期待・危険信号と回答を突き合わせて OK/NG を判定する。\n`;
    results.splice(1, 0, header);
    writeFileSync(RESULTS_PATH, results.join('\n'), 'utf-8');
    console.log(`\n=== 回答を ${RESULTS_PATH} に書き出しました(Claude に見せて OK/NG 判定) ===\n`);
  });

  for (const sc of scenarios) {
    it(sc.label, async () => {
      const mc = makeMemoryContext(sc.memory ?? {});
      const res = await chat(sc.userText, cc as CharacterContext, mc, makeRouterResult({ behavior: '相手の話に自然に応じる' }), apiKey);
      const answer = res.message;

      // --- 自動チェック ---
      const neverCallsSelf = (cc as CharacterContext).identity.selfRecognition.neverCallsSelf;
      const aiRef = detectAiSelfReference(answer, neverCallsSelf);
      const avoidHits = (sc.autoAvoid ?? []).filter((w) => answer.includes(w));
      const autoChecks: string[] = [
        answer.length > 0 ? '空でない=OK' : '空=NG',
        aiRef.detected ? `AI自称=検出(${aiRef.matchedWord ?? ''})` : 'AI自称=なし',
      ];
      if (sc.autoAvoid?.length) autoChecks.push(avoidHits.length ? `回避語ヒット=${avoidHits.join('/')}` : '回避語=なし');
      const autoFailed = aiRef.detected || answer.length === 0;
      if (autoFailed) autoFails += 1;

      results.push(
        [
          `## ${sc.label}`,
          `- 入力: ${sc.userText}`,
          `- 記憶: ${summarizeMemory(sc.memory)}`,
          sc.expect ? `- 期待(PASS): ${sc.expect}` : '',
          sc.redFlags ? `- 危険信号(FAIL): ${sc.redFlags}` : '',
          `- 自動チェック: ${autoChecks.join(' / ')}`,
          `- トリミの回答: ${answer}`,
          `- 暫定: ${autoFailed ? '⚠️自動FAIL' : '要Claude判定'}`,
          '',
        ].filter((s) => s.length > 0).join('\n'),
      );
      console.log(`\n[${sc.label}]\nQ: ${sc.userText}\nA: ${answer}\n`);

      // ハード gate は AI自称のみ(客観的)。妥当性の最終判定は Claude/人間(成功基準8)。
      expect(answer.length).toBeGreaterThan(0);
      expect(aiRef.detected, `AI自称を検知: ${aiRef.matchedWord ?? ''}`).toBe(false);
    }, 30000);
  }
});

import Anthropic from '@anthropic-ai/sdk';
import { RouterCache } from './cache';
import { parseRouterResponse } from './response-parser';
import { resolveDomain } from './domain-resolver';
import { buildFallbackResult } from './fallback';
import type { CharacterKnowledgeDomains } from '../shared/types/character';
import type { RouterResult } from '../shared/types/router';

// Knowledge Router 本体(設計書 §3.2「ベストエフォート方式」)。
// タイムアウト・失敗時は fallback を返し、本会話を絶対に止めない(例外を投げない)。

// B-03 計測(2026-06-09): 0 にして Router をスキップ(常に medium fallback)。
// 実 Haiku 往復(~1.5-2.5s)は 800ms 上限を必ず超え、毎回 fallback=medium になっていたため、
// 無駄な ~800ms/ターンを回収する。0(以下)のときは Haiku 呼び出しもせず即 fallback(下の classifyTopic ガード)。
// ※ トレードオフ:話題別 behavior は出なくなる(medium 固定)。速いまま正しく効かせるには B-15(ローカル判別器)。
const ROUTER_TIMEOUT_MS = 0; // NF-PERF-03 / B-03 計測(0=Routerスキップ)
const ROUTER_MODEL = 'claude-haiku-4-5-20251001';

/** Haiku を1回呼んで生テキストを返す関数(テストで差し替え可能)。 */
export type RouterLlmCall = (req: {
  system: string;
  userText: string;
  apiKey: string;
}) => Promise<string>;

// セッション内で共有するキャッシュ(ステートレスな判定 + 直近結果の再利用)。
const routerCache = new RouterCache();

/** テスト用: キャッシュを空にする。 */
export function clearRouterCache(): void {
  routerCache.clear();
}

function buildRouterSystemPrompt(knowledgeDomains: CharacterKnowledgeDomains): string {
  const d = knowledgeDomains.domains;
  return [
    'あなたは、あるキャラクターの知識範囲を判定するアシスタントです。',
    'ユーザー入力のトピックが、以下のどのドメインに該当するかを判定してください。',
    '',
    `high: ${d.high.topics.join('、')}`,
    `medium: ${d.medium.topics.join('、')}`,
    `low: ${d.low.topics.join('、')}`,
    `none: ${d.none.topics.join('、')}`,
    `refuse: ${d.refuse.topics.join('、')}`,
    '',
    '判定基準:',
    `- どれにも明確に該当しない場合は "${knowledgeDomains.fallback}" を返す。`,
    '- 出力は次の JSON のみ: {"domain": "high"|"medium"|"low"|"none"|"refuse", "matchedTopic": "..."}',
  ].join('\n');
}

/** 既定の Haiku 呼び出し。Prefill は現行モデルが非対応のため使わず、応答をそのままパースする。 */
const defaultHaikuCall: RouterLlmCall = async ({ system, userText, apiKey }) => {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: ROUTER_MODEL,
    max_tokens: 100,
    temperature: 0.0,
    system,
    messages: [{ role: 'user', content: userText }],
  });
  return resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
};

function timeout(ms: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Router timeout')), ms);
  });
}

async function classifyOnce(
  userText: string,
  knowledgeDomains: CharacterKnowledgeDomains,
  apiKey: string,
  llmCall: RouterLlmCall,
): Promise<RouterResult> {
  const system = buildRouterSystemPrompt(knowledgeDomains);
  const raw = await llmCall({ system, userText, apiKey });
  const parsed = parseRouterResponse(raw);
  if (!parsed) {
    throw new Error('Router response parse failed'); // → fallback
  }
  const { behavior, fewshotKey } = resolveDomain(parsed.domain, knowledgeDomains);
  return {
    domain: parsed.domain,
    behavior,
    fewshotKey,
    matchedTopic: parsed.matchedTopic,
    isFromCache: false,
    isFromFallback: false,
  };
}

export async function classifyTopic(
  userText: string,
  knowledgeDomains: CharacterKnowledgeDomains,
  apiKey: string,
  llmCall: RouterLlmCall = defaultHaikuCall,
  timeoutMs: number = ROUTER_TIMEOUT_MS,
): Promise<RouterResult> {
  // タイムアウト 0(以下)= Router を実行せず即 fallback(B-03 計測)。Haiku 往復もしない=レイテンシ/コスト 0。
  // 既定は本番の ROUTER_TIMEOUT_MS(現在 0=無効)。テストは非ゼロを渡して分類/キャッシュ経路を検証する。
  if (timeoutMs <= 0) {
    return buildFallbackResult(knowledgeDomains);
  }

  const cached = routerCache.get(userText);
  if (cached) {
    return { ...cached, isFromCache: true };
  }

  try {
    const result = await Promise.race([
      classifyOnce(userText, knowledgeDomains, apiKey, llmCall),
      timeout(timeoutMs),
    ]);
    routerCache.set(userText, result); // 成功結果のみキャッシュ(fallback は入れない)
    return result;
  } catch {
    // タイムアウト / API 失敗 / パース失敗 → fallback で会話継続(設計書 §3.2)
    return buildFallbackResult(knowledgeDomains);
  }
}

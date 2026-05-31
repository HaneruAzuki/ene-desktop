import Anthropic from '@anthropic-ai/sdk';
import { RouterCache } from './cache';
import { parseRouterResponse } from './response-parser';
import { resolveDomain } from './domain-resolver';
import { buildFallbackResult } from './fallback';
import type { CharacterKnowledgeDomains } from '../shared/types/character';
import type { RouterResult } from '../shared/types/router';

// Knowledge Router 本体(設計書 §3.2「ベストエフォート方式」)。
// タイムアウト・失敗時は fallback を返し、本会話を絶対に止めない(例外を投げない)。

const ROUTER_TIMEOUT_MS = 800; // NF-PERF-03
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

/** 既定の Haiku 呼び出し(Prefill で JSON を強制)。 */
const defaultHaikuCall: RouterLlmCall = async ({ system, userText, apiKey }) => {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: ROUTER_MODEL,
    max_tokens: 100,
    temperature: 0.0,
    system,
    messages: [
      { role: 'user', content: userText },
      { role: 'assistant', content: '{' }, // Prefill
    ],
  });
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return `{${text}`; // Prefill の "{" はレスポンスに含まれないので補完
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
): Promise<RouterResult> {
  const cached = routerCache.get(userText);
  if (cached) {
    return { ...cached, isFromCache: true };
  }

  try {
    const result = await Promise.race([
      classifyOnce(userText, knowledgeDomains, apiKey, llmCall),
      timeout(ROUTER_TIMEOUT_MS),
    ]);
    routerCache.set(userText, result); // 成功結果のみキャッシュ(fallback は入れない)
    return result;
  } catch {
    // タイムアウト / API 失敗 / パース失敗 → fallback で会話継続(設計書 §3.2)
    return buildFallbackResult(knowledgeDomains);
  }
}

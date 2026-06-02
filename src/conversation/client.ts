import Anthropic from '@anthropic-ai/sdk';
import { log } from '../shared/logger';
import { buildPrompt } from './prompt-builder';
import { parseConversationResponse } from './response-parser';
import { detectAiSelfReference } from './ai-self-check';
import { enhancePromptForRegeneration } from './prompt-enhancer';
import { fallbackResponse } from './fallback';
import { countAndCheck, type TokenCheck } from './token-counter';
import type { CharacterContext } from '../shared/types/character';
import type { MemoryContext } from '../shared/types/memory';
import type { RouterResult } from '../shared/types/router';
import type { BuiltPrompt, ConversationResponse } from '../shared/types/conversation';
import type { LlmComplete } from '../memory/extractor';

// 本会話処理(設計書 §3.4「Conversation Layer の統合フロー」)。
// AI自称防止の4層防御を統合する。Sonnet 呼び出し・トークン計測は DI 可能(テスト容易化)。

const CONVERSATION_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.7; // キャラの自然さと JSON 安定性のバランス(設計書 §3.4)

/** Sonnet を1回呼び、応答の生テキスト(完全な JSON 文字列)を返す。 */
export type ModelCall = (prompt: BuiltPrompt) => Promise<string>;
/** プロンプトのトークン数を判定する。 */
export type TokenChecker = (prompt: BuiltPrompt) => Promise<TokenCheck>;

export interface ChatDeps {
  callModel: ModelCall;
  checkTokens: TokenChecker;
  /** 401/402/429 等の認証系エラーを検知した時に呼ばれる(main 側でダイアログ再表示に使う)。 */
  onAuthError?: (error: unknown) => void;
}

/** 認証系(401/402/429)エラーかを判定する(electron 非依存・純粋)。 */
function isAuthLikeError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 401 || status === 402 || status === 429;
}

function makeDefaultDeps(apiKey: string): ChatDeps {
  const client = new Anthropic({ apiKey });
  return {
    callModel: async ({ system, messages }) => {
      const resp = await client.messages.create({
        model: CONVERSATION_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system,
        messages,
      });
      const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      // 末尾 messages の Prefill "{" はレスポンスに含まれないため補完する。
      return `{${text}`;
    },
    // トークン計測は SDK の countTokens が固定版に無いため、ローカル見積もりで判定する。
    checkTokens: async (prompt) => countAndCheck(prompt),
  };
}

/**
 * 記憶抽出など「単発で生テキストを得たい」用途の LLM 呼び出しを作る。
 * Memory Layer の extractor へ注入する LlmComplete を満たす(設計書 §3.3 の抽出は Sonnet 使用)。
 */
export function makeLlmComplete(apiKey: string): LlmComplete {
  const client = new Anthropic({ apiKey });
  return async ({ system, user, maxTokens }) => {
    const resp = await client.messages.create({
      model: CONVERSATION_MODEL,
      max_tokens: maxTokens ?? MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  };
}

const skipTokenCheck: TokenChecker = async () => ({ ok: true, tokens: 0 });

function resolveDeps(apiKey: string, deps?: Partial<ChatDeps>): ChatDeps {
  const hasCustomModel = Boolean(deps?.callModel);
  const base = hasCustomModel ? null : makeDefaultDeps(apiKey);
  return {
    callModel: deps?.callModel ?? (base as ChatDeps).callModel,
    checkTokens: deps?.checkTokens ?? (hasCustomModel ? skipTokenCheck : (base as ChatDeps).checkTokens),
    onAuthError: deps?.onAuthError,
  };
}

export async function chat(
  userText: string,
  charContext: CharacterContext,
  memoryContext: MemoryContext,
  routerResult: RouterResult,
  apiKey: string,
  deps?: Partial<ChatDeps>,
): Promise<ConversationResponse> {
  const { callModel, checkTokens, onAuthError } = resolveDeps(apiKey, deps);
  const neverCallsSelf = charContext.identity.selfRecognition.neverCallsSelf;

  // 第1防御: プロンプトに neverCallsSelf を明示(buildPrompt 内)
  const prompt = buildPrompt(charContext, memoryContext, routerResult, userText);

  // トークン上限チェック(NF-PERF-08: hard_limit は拒否)
  const tokenCheck = await checkTokens(prompt);
  if (!tokenCheck.ok && tokenCheck.reason === 'hard_limit') {
    log.warn(`token hard limit exceeded (${tokenCheck.tokens}); rejecting request`);
    return fallbackResponse();
  }

  // 通常リクエスト
  let raw: string;
  try {
    raw = await callModel(prompt);
  } catch (e) {
    log.error('conversation model call failed', { name: (e as Error).name });
    if (isAuthLikeError(e)) onAuthError?.(e); // 認証失効 → main 側でダイアログ再表示
    return fallbackResponse();
  }

  const parsed = parseConversationResponse(raw);
  if (!parsed) {
    return fallbackResponse(); // パース失敗 → fallback
  }

  // 第2防御: AI自称検知
  const check = detectAiSelfReference(parsed.message, neverCallsSelf);
  if (!check.detected) {
    return parsed;
  }
  log.warn(`AI self-reference detected: pattern=${check.matchedPattern ?? ''}`);

  // 第3防御: 強化プロンプトで再生成(1回だけ)
  const enhanced: BuiltPrompt = {
    system: enhancePromptForRegeneration(prompt.system, check.matchedWord ?? ''),
    messages: prompt.messages,
  };
  let raw2: string;
  try {
    raw2 = await callModel(enhanced);
  } catch (e) {
    log.error('conversation regeneration call failed', { name: (e as Error).name });
    if (isAuthLikeError(e)) onAuthError?.(e);
    return fallbackResponse();
  }

  const parsed2 = parseConversationResponse(raw2);
  if (!parsed2) {
    return fallbackResponse();
  }

  const recheck = detectAiSelfReference(parsed2.message, neverCallsSelf);
  if (recheck.detected) {
    // 第4防御: フォールバック
    log.error('AI self-reference still detected after regeneration');
    return fallbackResponse();
  }
  return parsed2;
}

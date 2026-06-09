import Anthropic from '@anthropic-ai/sdk';
import { log } from '../shared/logger';
import { buildPrompt } from './prompt-builder';
import { parseConversationResponse } from './response-parser';
import { detectAiSelfReference } from './ai-self-check';
import { enhancePromptForRegeneration } from './prompt-enhancer';
import { fallbackResponse } from './fallback';
import { countAndCheck, type TokenCheck } from './token-counter';
import type { CharacterContext } from '../shared/types/character';
import type { MemoryContext, SemanticMemory } from '../shared/types/memory';
import type { RouterResult } from '../shared/types/router';
import type { BuiltPrompt, ConversationResponse } from '../shared/types/conversation';
import type { LlmComplete } from '../memory/extractor';

// 本会話処理(設計書 §3.4「Conversation Layer の統合フロー」)。
// AI自称防止の4層防御を統合する。Sonnet 呼び出し・トークン計測は DI 可能(テスト容易化)。

/** 生成モデル(B-15b 二段生成)。既定=Sonnet(品質・一貫性=成功基準8)。雑談は Haiku に振り分け可。 */
export const MODEL_SONNET = 'claude-sonnet-4-6';
export const MODEL_HAIKU = 'claude-haiku-4-5';
/** 既定の生成モデル(抽出・要約・ウォーム・二段オフ時)。 */
const CONVERSATION_MODEL = MODEL_SONNET;
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.7; // キャラの自然さと JSON 安定性のバランス(設計書 §3.4)

/** Sonnet を1回呼び、応答の生テキスト(完全な JSON 文字列)を返す。 */
export type ModelCall = (prompt: BuiltPrompt) => Promise<string>;
/** プロンプトのトークン数を判定する。 */
export type TokenChecker = (prompt: BuiltPrompt) => Promise<TokenCheck>;
/** Sonnet をストリーミング呼び出しし、テキストデルタを順次 yield する(C1・B-06)。 */
export type ModelStreamCall = (prompt: BuiltPrompt) => AsyncIterable<string>;

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

const EPHEMERAL = { type: 'ephemeral' as const };

/** SystemBlock[] を SDK の system パラメータへ(cacheable ブロックに cache_control を付与・task_14)。 */
function toSystemParam(system: BuiltPrompt['system']): Anthropic.Beta.PromptCaching.PromptCachingBetaTextBlockParam[] {
  return system.map((b) =>
    b.cacheable
      ? { type: 'text', text: b.text, cache_control: EPHEMERAL }
      : { type: 'text', text: b.text },
  );
}

/** PromptMessage[] を SDK の messages へ(cacheable メッセージは content をブロック化し境界に・task_14)。 */
function toMessagesParam(messages: BuiltPrompt['messages']): Anthropic.Beta.PromptCaching.PromptCachingBetaMessageParam[] {
  return messages.map((m) =>
    m.cacheable
      ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: EPHEMERAL }] }
      : { role: m.role, content: m.content },
  );
}

function makeDefaultDeps(apiKey: string, model: string = CONVERSATION_MODEL): ChatDeps {
  const client = new Anthropic({ apiKey });
  return {
    callModel: async ({ system, messages }) => {
      // 0.30.1 のプロンプトキャッシュはベータ名前空間(N-14)。Tier0 を固定プレフィックスとして使い回す。
      const resp = await client.beta.promptCaching.messages.create({
        model, // 二段生成(B-15b): Haiku/Sonnet をターンごとに切替可。既定=Sonnet。
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: toSystemParam(system),
        messages: toMessagesParam(messages),
      });
      // キャッシュ命中状況をログ(トークン数のみ・会話内容や PII は載せない・CLAUDE §6.2)。
      const u = resp.usage;
      log.info(
        `cache usage: write=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0} input=${u.input_tokens}`,
      );
      // Prefill は使わないので、応答テキストをそのまま返す(パーサが JSON を抽出する)。
      return resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
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

/**
 * Sonnet のストリーミング呼び出し(C1・B-06)。テキストデルタを順次 yield する。
 * runVoiceChat が消費し、文単位で「自称検知 → 合成 → 再生」して第一声を早める。
 * プロンプトは非ストリーミングと同一(JSON＋ルビ)。emotion を message より前に置く前提で早期確定する。
 */
export function makeStreamCall(apiKey: string, model: string = CONVERSATION_MODEL): ModelStreamCall {
  const client = new Anthropic({ apiKey });
  return async function* stream({ system, messages }): AsyncGenerator<string> {
    const events = await client.beta.promptCaching.messages.create({
      model, // 二段生成(B-15b)。既定=Sonnet。
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: toSystemParam(system),
      messages: toMessagesParam(messages),
      stream: true,
    });
    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  };
}

// ウォーム用のダミー router 結果(揮発コンテキストはキャッシュ境界より後ろ＝中身は不問)。
const WARM_ROUTER: RouterResult = {
  domain: 'medium',
  behavior: '',
  fewshotKey: '',
  isFromCache: false,
  isFromFallback: false,
};

/**
 * クリック起点ウォーム(task_14 Phase 3)。入力欄を開いた瞬間に、本会話と**同一の安定プレフィックス**
 * (Tier0 ＋ semantic ＋ 固定 few-shot)を `max_tokens:1` で送ってキャッシュを書き込む。
 * 揮発物(episodic/behavior)はキャッシュ境界より後ろなのでダミーでよい＝本送信が確実にキャッシュを読む。
 * 位置づけは**レイテンシ施策**(コストは微増)。best-effort で失敗しても会話に影響させない。
 */
export async function warmPromptCache(
  charContext: CharacterContext,
  semantic: SemanticMemory,
  apiKey: string,
): Promise<void> {
  try {
    const client = new Anthropic({ apiKey });
    // 本会話と同じ buildPrompt を使い、キャッシュ可能プレフィックスをバイト同一で再現する。
    const prompt = buildPrompt(charContext, { semantic, shortTerm: [], relevantEpisodic: [] }, WARM_ROUTER, 'warm');
    await client.beta.promptCaching.messages.create({
      model: CONVERSATION_MODEL,
      max_tokens: 1,
      system: toSystemParam(prompt.system),
      messages: toMessagesParam(prompt.messages),
    });
  } catch (e) {
    log.warn(`prompt cache warm failed: ${(e as Error).name}`);
  }
}

const skipTokenCheck: TokenChecker = async () => ({ ok: true, tokens: 0 });

function resolveDeps(
  apiKey: string,
  deps?: Partial<ChatDeps>,
  model: string = CONVERSATION_MODEL,
): ChatDeps {
  const hasCustomModel = Boolean(deps?.callModel);
  const base = hasCustomModel ? null : makeDefaultDeps(apiKey, model);
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
  model: string = CONVERSATION_MODEL, // 二段生成(B-15b)。既定=Sonnet。
): Promise<ConversationResponse> {
  const { callModel, checkTokens, onAuthError } = resolveDeps(apiKey, deps, model);
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

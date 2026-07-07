import Anthropic from '@anthropic-ai/sdk';
import { log } from '../shared/logger';
import { buildPrompt } from './prompt-builder';
import { parseConversationResponse } from './response-parser';
import { detectAiSelfReference } from '../shared/ai-self-check';
import { fallbackResponse } from './fallback';
import type { CharacterContext } from '../shared/types/character';
import type { MemoryContext, SemanticMemory } from '../shared/types/memory';
import type { RouterResult } from '../shared/types/router';
import type { BuiltPrompt, ConversationResponse } from '../shared/types/conversation';
import type { LlmComplete } from '../shared/types/llm';

// 本会話処理(設計書 §3.4「Conversation Layer の統合フロー」)。
// AI自称防止の3層防御を統合する(①プロンプト ②自称検知 ③フォールバック)。Sonnet 呼び出しは DI 可能(テスト容易化)。
// 旧・第3層「強化プロンプトで再生成1回」は撤去(2026-06-23):発話済みを取り消せないストリーミングでは
// 構造的に不可能で、非ストリーミングだけ効く非対称な防御は無意味かつ複雑だったため(ストリーミングと統一)。

/** 生成モデル(B-15b 二段生成)。既定=Sonnet(品質・一貫性=成功基準8)。雑談は Haiku に振り分け可。 */
export const MODEL_SONNET = 'claude-sonnet-4-6';
export const MODEL_HAIKU = 'claude-haiku-4-5';
/** 既定の生成モデル(抽出・要約・ウォーム・二段オフ時)。 */
const CONVERSATION_MODEL = MODEL_SONNET;
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.7; // キャラの自然さと JSON 安定性のバランス(設計書 §3.4)
/** Sonnet の思考深さ/トークン量(effort・GA)。雑談主体ゆえ既定 high より medium で体感を縮める(★1)。 */
const CONVERSATION_EFFORT = 'medium' as const;

/**
 * Claude API の送信先を公式エンドポイントに固定する(セキュリティ・§4.2/§7.1)。
 * SDK は baseURL 未指定だと環境変数 `ANTHROPIC_BASE_URL` を読むため、悪意ある env で
 * 会話テキスト(唯一の外部送信)を任意の URL へ転送されうる。明示固定でその経路を塞ぐ。
 */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/** baseURL を公式に固定した Anthropic クライアントを生成する(全構築をここに集約)。 */
function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL });
}

/** Sonnet を1回呼び、応答の生テキスト(完全な JSON 文字列)を返す。 */
export type ModelCall = (prompt: BuiltPrompt) => Promise<string>;
/** Sonnet をストリーミング呼び出しし、テキストデルタを順次 yield する(C1・B-06)。 */
export type ModelStreamCall = (prompt: BuiltPrompt) => AsyncIterable<string>;

export interface ChatDeps {
  callModel: ModelCall;
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
function toSystemParam(system: BuiltPrompt['system']): Anthropic.TextBlockParam[] {
  return system.map((b) =>
    b.cacheable
      ? { type: 'text', text: b.text, cache_control: EPHEMERAL }
      : { type: 'text', text: b.text },
  );
}

/** PromptMessage[] を SDK の messages へ(cacheable メッセージは content をブロック化し境界に・task_14)。 */
function toMessagesParam(messages: BuiltPrompt['messages']): Anthropic.MessageParam[] {
  return messages.map((m) =>
    m.cacheable
      ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: EPHEMERAL }] }
      : { role: m.role, content: m.content },
  );
}

/**
 * モデル別のレイテンシ調整(★1)。本会話は思考不要なので両モデルで thinking を無効化し、
 * Sonnet には effort:medium を付ける(既定 high より体感が縮む)。
 * Haiku 4.5 は effort 非対応(指定すると 400)なので付けない。
 */
function tuningFor(model: string): { thinking: Anthropic.ThinkingConfigParam; output_config?: Anthropic.OutputConfig } {
  const thinking: Anthropic.ThinkingConfigParam = { type: 'disabled' };
  return model === MODEL_HAIKU ? { thinking } : { thinking, output_config: { effort: CONVERSATION_EFFORT } };
}

function makeDefaultDeps(
  apiKey: string,
  model: string = CONVERSATION_MODEL,
  signal?: AbortSignal, // 中断(barge-in / supersede)。非ストリーミング fallback でも HTTP を打ち切れるように。
): ChatDeps {
  const client = createClient(apiKey);
  return {
    callModel: async ({ system, messages }) => {
      // プロンプトキャッシュ(GA)。固定プレフィックスを使い回してキャッシュヒットさせる。
      const resp = await client.messages.create(
        {
          model, // 二段生成(B-15b): Haiku/Sonnet をターンごとに切替可。既定=Sonnet。
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          ...tuningFor(model), // ★1: thinking 無効 ＋ Sonnet は effort:medium(レイテンシ削減)
          system: toSystemParam(system),
          messages: toMessagesParam(messages),
        },
        signal ? { signal } : undefined,
      );
      // キャッシュ命中状況をログ(トークン数のみ・会話内容や PII は載せない・CLAUDE §6.2)。
      const u = resp.usage;
      log.info(
        `cache usage: write=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0} input=${u.input_tokens}`,
      );
      // Prefill は使わないので、応答テキストをそのまま返す(パーサが JSON を抽出する)。
      return resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    },
  };
}

/**
 * 記憶抽出など「単発で生テキストを得たい」用途の LLM 呼び出しを作る。
 * Memory Layer の extractor へ注入する LlmComplete を満たす(設計書 §3.3 の抽出は Sonnet 使用)。
 */
export function makeLlmComplete(apiKey: string): LlmComplete {
  const client = createClient(apiKey);
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
export function makeStreamCall(
  apiKey: string,
  model: string = CONVERSATION_MODEL,
  signal?: AbortSignal, // コアレッシングの中断(投機生成のキャンセル)。abort で HTTP も止めトークンを節約する。
): ModelStreamCall {
  const client = createClient(apiKey);
  return async function* stream({ system, messages }): AsyncGenerator<string> {
    const events = await client.messages.create(
      {
        model, // 二段生成(B-15b)。既定=Sonnet。
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        ...tuningFor(model), // ★1: thinking 無効 ＋ Sonnet は effort:medium(レイテンシ削減)
        system: toSystemParam(system),
        messages: toMessagesParam(messages),
        stream: true,
      },
      signal ? { signal } : undefined,
    );
    for await (const event of events) {
      // 3(b): ストリームでも message_start の usage でキャッシュ命中が分かる(トークン数のみ・PII禁止・§6.2)。
      if (event.type === 'message_start') {
        const u = event.message.usage;
        log.info(
          `cache usage(stream): write=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0} input=${u.input_tokens}`,
        );
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
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
    const client = createClient(apiKey);
    // 本会話と同じ buildPrompt を使い、キャッシュ可能プレフィックスをバイト同一で再現する。
    const prompt = buildPrompt(charContext, { semantic, shortTerm: [], relevantEpisodic: [] }, WARM_ROUTER, 'warm');
    await client.messages.create({
      model: CONVERSATION_MODEL,
      max_tokens: 1,
      thinking: { type: 'disabled' }, // 本送信と messages 層キャッシュを一致させる(effort はキャッシュ非依存)
      system: toSystemParam(prompt.system),
      messages: toMessagesParam(prompt.messages),
    });
  } catch (e) {
    log.warn(`prompt cache warm failed: ${(e as Error).name}`);
  }
}

function resolveDeps(
  apiKey: string,
  deps?: Partial<ChatDeps>,
  model: string = CONVERSATION_MODEL,
  signal?: AbortSignal,
): ChatDeps {
  const base = deps?.callModel ? null : makeDefaultDeps(apiKey, model, signal);
  return {
    callModel: deps?.callModel ?? (base as ChatDeps).callModel,
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
  signal?: AbortSignal, // 中断(barge-in / supersede)。fallback の非ストリーミング呼び出しでも HTTP を打ち切る。
): Promise<ConversationResponse> {
  const { callModel, onAuthError } = resolveDeps(apiKey, deps, model, signal);
  const neverCallsSelf = charContext.identity.selfRecognition.neverCallsSelf;
  const selfRefTemplates = charContext.language.selfRefTemplates; // 自称検知テンプレ(language.json・§4.5)

  // 第1防御: プロンプトに neverCallsSelf を明示(buildPrompt 内)
  const prompt = buildPrompt(charContext, memoryContext, routerResult, userText);

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

  // 第2防御: AI自称検知 → 検知時は第3防御=フォールバック(再生成はしない)。
  // 発話済みを取り消せないストリーミング経路(文単位 C2)と防御を統一する(非対称な再生成を撤去・2026-06-23)。
  const check = detectAiSelfReference(parsed.message, neverCallsSelf, selfRefTemplates);
  if (check.detected) {
    log.warn(`AI self-reference detected: pattern=${check.matchedPattern ?? ''}`);
    return fallbackResponse();
  }
  return parsed;
}

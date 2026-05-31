import { log } from '../shared/logger';
import type { BuiltPrompt } from '../shared/types/conversation';

// 入力トークン上限管理(設計書 §3.4 / 要件 NF-PERF-06〜08)。
//
// 📌 設計書 §3.4 は Anthropic SDK の `client.messages.countTokens` を使う想定だが、
//    固定中の SDK(^0.30.x)には countTokens API が無い(後発版で追加)。
//    SDK 更新はバージョン規約(CLAUDE §2.4)上ユーザー承認が必要なため、MVP では
//    ローカルの簡易見積もりでガードレールを実装する(上限は保護目的)。
//    厳密計測が必要になれば SDK 更新を検討(docs/implementation-notes.md 参照)。

export const TOKEN_TARGET = 20_000;
export const TOKEN_WARN_LIMIT = 25_000;
export const TOKEN_HARD_LIMIT = 50_000;

// 1 トークンあたりの推定文字数。日本語混在を考慮しやや小さめ(過少カウントを避ける)。
const CHARS_PER_TOKEN = 2.5;

export interface TokenCheck {
  ok: boolean;
  tokens: number;
  reason?: 'warn' | 'hard_limit';
}

/** 文字数からおおよそのトークン数を見積もる。 */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/** プロンプト全体(system + 全メッセージ)の推定入力トークン数。 */
export function estimatePromptTokens(prompt: BuiltPrompt): number {
  let chars = prompt.system.length;
  for (const m of prompt.messages) {
    chars += m.content.length;
  }
  return estimateTokens(chars);
}

/** トークン数を上限と照合する(純粋関数)。 */
export function classifyTokenCount(inputTokens: number): TokenCheck {
  if (inputTokens > TOKEN_HARD_LIMIT) {
    return { ok: false, tokens: inputTokens, reason: 'hard_limit' };
  }
  if (inputTokens > TOKEN_WARN_LIMIT) {
    log.warn(`input tokens (${inputTokens}) exceed warning limit (${TOKEN_WARN_LIMIT})`);
    return { ok: true, tokens: inputTokens, reason: 'warn' };
  }
  return { ok: true, tokens: inputTokens };
}

/** プロンプトのトークン数を見積もって上限判定する。 */
export function countAndCheck(prompt: BuiltPrompt): TokenCheck {
  return classifyTokenCount(estimatePromptTokens(prompt));
}

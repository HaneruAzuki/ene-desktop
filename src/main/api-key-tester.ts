import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_BASE_URL } from '../conversation/client';
import type { PingResult } from '../shared/types/api-key';

// APIキーの形式検証と疎通テスト(設計書 §3.7「バリデーションの3段階」)。

/** 段階1: 入力時の即時形式チェック(同期・純粋)。 */
export function isValidKeyFormat(key: string): boolean {
  return key.startsWith('sk-ant-') && key.length >= 50;
}

/** 疎通テスト用の最小 ping(テストで差し替え可能)。 */
export type ApiKeyPing = (key: string) => Promise<void>;

const defaultPing: ApiKeyPing = async (key) => {
  const client = new Anthropic({ apiKey: key, baseURL: ANTHROPIC_BASE_URL });
  await client.messages.create({
    model: 'claude-haiku-4-5-20251001', // 軽量モデルで最小コスト
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
};

/**
 * 段階2: 疎通テスト。エラー種別(auth / credit / network / other)を区別する。
 * 例外を投げず PingResult を返す。
 */
export async function testApiKey(key: string, ping: ApiKeyPing = defaultPing): Promise<PingResult> {
  try {
    await ping(key);
    return { ok: true };
  } catch (e) {
    const err = e as { status?: number; code?: string };
    if (err.status === 401) return { ok: false, reason: 'auth' };
    if (err.status === 402 || err.status === 429) return { ok: false, reason: 'credit' };
    if (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
      return { ok: false, reason: 'network' };
    }
    return { ok: false, reason: 'other', detail: String(e) };
  }
}

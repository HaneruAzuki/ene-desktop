import { log } from '../shared/logger';
import { resolveDomain } from './domain-resolver';
import type { CharacterKnowledgeDomains } from '../shared/types/character';
import type { RouterResult } from '../shared/types/router';

// タイムアウト・失敗時の fallback 結果を構築する(設計書 §3.2)。
// 本会話を絶対に止めない(ベストエフォート方式)。

export function buildFallbackResult(knowledgeDomains: CharacterKnowledgeDomains): RouterResult {
  const domain = knowledgeDomains.fallback;
  const { behavior, fewshotKey } = resolveDomain(domain, knowledgeDomains);
  // メタ情報のみログ(個人情報・入力内容は含めない・CLAUDE §6.2)
  log.warn(`Router fallback used: domain=${domain}`);
  return {
    domain,
    behavior,
    fewshotKey,
    isFromCache: false,
    isFromFallback: true,
  };
}

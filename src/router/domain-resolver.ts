import type { CharacterKnowledgeDomains, DomainLevel } from '../shared/types/character';

// 判定された domain 名から KnowledgeDomain 情報を取得する(設計書 §3.2)。

export function resolveDomain(
  domain: DomainLevel,
  knowledgeDomains: CharacterKnowledgeDomains,
): { behavior: string; fewshotKey: string } {
  const found = knowledgeDomains.domains[domain];
  if (found) {
    return { behavior: found.behavior, fewshotKey: found.fewshotKey };
  }
  // 理論上発生しないが、未定義なら fallback ドメインへ安全側に倒す。
  const fb = knowledgeDomains.domains[knowledgeDomains.fallback];
  return { behavior: fb.behavior, fewshotKey: fb.fewshotKey };
}

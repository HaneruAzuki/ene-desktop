import type { DomainLevel } from './character';

// Knowledge Router の型定義(設計書 §3.2)。

export interface RouterResult {
  domain: DomainLevel; // 判定されたドメイン
  behavior: string; // domain.behavior の転記
  fewshotKey: string; // domain.fewshotKey の転記
  matchedTopic?: string; // マッチしたトピック(あれば)
  isFromCache: boolean; // キャッシュヒットしたか
  isFromFallback: boolean; // フォールバックを使用したか
}

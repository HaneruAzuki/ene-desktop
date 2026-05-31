import type { DomainLevel } from '../shared/types/character';

// Router 応答(Haiku)の JSON パース(設計書 §3.2 / §3.4)。
// task_05 のパース堅牢化と同等の簡易版を Router 内で完結させる。

const VALID_DOMAINS: readonly DomainLevel[] = ['high', 'medium', 'low', 'none', 'refuse'];

export interface ParsedRouterResponse {
  domain: DomainLevel;
  matchedTopic?: string;
}

export function parseRouterResponse(raw: string): ParsedRouterResponse | null {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  text = text.slice(first, last + 1);

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.domain !== 'string') return null;
    if (!VALID_DOMAINS.includes(obj.domain as DomainLevel)) return null;
    return {
      domain: obj.domain as DomainLevel,
      matchedTopic: typeof obj.matchedTopic === 'string' ? obj.matchedTopic : undefined,
    };
  } catch {
    return null;
  }
}

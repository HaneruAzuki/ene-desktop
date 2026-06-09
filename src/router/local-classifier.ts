import { resolveDomain } from './domain-resolver';
import { buildFallbackResult } from './fallback';
import { getDefaultEmbedder, isEmbeddingModelAvailable, type Embedder } from '../memory/embedder';
import { log } from '../shared/logger';
import {
  ROUTER_KEYWORD_MIN_LEN,
  ROUTER_EMBED_MIN_CHARS,
  LOCAL_ROUTER_SIM_THRESHOLD,
} from '../shared/constants';
import type { CharacterKnowledgeDomains, DomainLevel } from '../shared/types/character';
import type { RouterResult } from '../shared/types/router';

// ローカル判別器(B-15)。Haiku Router(ネットワーク往復)を置換し、完全ローカル0往復で
// ユーザー発話 → knowledge domain を判定する。生成は依然 Claude=判別器は behavior/few-shot の枠を選ぶだけ。
//
// ハイブリッド:
//   ① キーワード一致(topics の部分文字列・即時・正確)
//   ② 埋め込み類似(ウォーム済 ruri を想起と共用・言い換えを拾う)
//   ③ 迷ったら fallback(medium)=「迷ったら medium」の保守原則。
// 安全側: いずれの失敗(モデル未配置/embed 例外)も buildFallbackResult(medium) に倒し会話を止めない。
//   知識境界は system プロンプトにも含まれるため、判別ミス時も Claude 側で破綻しない(二重防御)。

/** 複数 domain が一致したときの優先順(安全・境界 → 専門 → 一般)。 */
const DOMAIN_PRIORITY: readonly DomainLevel[] = ['refuse', 'none', 'high', 'low', 'medium'];

interface LocalMatch {
  domain: DomainLevel;
  matchedTopic: string;
}

/**
 * キーワード(topics の部分文字列)一致で domain を判定する(純粋・同期)。一致なしは null。
 * 1文字 topic(車/薬 等)は誤一致(電車/薬局)を避けて除外し、埋め込みに委ねる(ROUTER_KEYWORD_MIN_LEN)。
 */
export function classifyByKeyword(
  text: string,
  knowledgeDomains: CharacterKnowledgeDomains,
): LocalMatch | null {
  for (const domain of DOMAIN_PRIORITY) {
    const d = knowledgeDomains.domains[domain];
    if (!d) continue;
    const hit = d.topics.find((t) => t.length >= ROUTER_KEYWORD_MIN_LEN && text.includes(t));
    if (hit) return { domain, matchedTopic: hit };
  }
  return null;
}

// 埋め込み済み topics ベクトルのキャッシュ(キャラ単位・topics は安定)。
interface TopicVec {
  domain: DomainLevel;
  topic: string;
  vec: number[];
}
const topicVecCache = new Map<string, TopicVec[]>(); // key = characterId

/** 正規化ベクトル同士のコサイン類似(=内積)。embedder は normalize 済みを返す。 */
function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

/** 全 topics を document 埋め込みして domain 付きでキャッシュする(初回のみ・冪等)。 */
async function getTopicVectors(
  knowledgeDomains: CharacterKnowledgeDomains,
  embedder: Embedder,
): Promise<TopicVec[]> {
  const cached = topicVecCache.get(knowledgeDomains.characterId);
  if (cached) return cached;
  const flat: { domain: DomainLevel; topic: string }[] = [];
  for (const domain of DOMAIN_PRIORITY) {
    const d = knowledgeDomains.domains[domain];
    if (!d) continue;
    for (const topic of d.topics) if (topic.length > 0) flat.push({ domain, topic });
  }
  const vecs = await embedder.embed(
    flat.map((f) => f.topic),
    'document',
  );
  const out: TopicVec[] = flat.map((f, i) => ({ domain: f.domain, topic: f.topic, vec: vecs[i] ?? [] }));
  topicVecCache.set(knowledgeDomains.characterId, out);
  return out;
}

/**
 * 埋め込み類似で domain を判定する。最良 topic の類似が threshold 以上なら採用、未満は null。
 * 起動時に warmLocalRouter で topics を温めておけば、実行時は発話 query 埋め込み1回(想起とキャッシュ共有)。
 */
export async function classifyByEmbedding(
  text: string,
  knowledgeDomains: CharacterKnowledgeDomains,
  embedder: Embedder,
  threshold: number = LOCAL_ROUTER_SIM_THRESHOLD,
): Promise<(LocalMatch & { score: number }) | null> {
  const topics = await getTopicVectors(knowledgeDomains, embedder);
  if (topics.length === 0) return null;
  const [qv] = await embedder.embed([text], 'query');
  if (!qv) return null;
  let best: (LocalMatch & { score: number }) | null = null;
  for (const t of topics) {
    if (t.vec.length === 0) continue;
    const score = cosine(qv, t.vec);
    if (!best || score > best.score) best = { domain: t.domain, matchedTopic: t.topic, score };
  }
  return best && best.score >= threshold ? best : null;
}

export interface LocalRouterDeps {
  embedder?: Embedder;
  embeddingAvailable?: () => Promise<boolean>;
  simThreshold?: number;
}

/**
 * ローカル判別の本体(ハイブリッド)。RouterResult を返す(Haiku Router と同じ出力形=下流無改修)。
 * キーワード→埋め込み→fallback の順。embed の失敗・未配置は medium fallback で安全に倒す。
 */
export async function classifyTopicLocal(
  text: string,
  knowledgeDomains: CharacterKnowledgeDomains,
  deps: LocalRouterDeps = {},
): Promise<RouterResult> {
  const make = (m: LocalMatch): RouterResult => {
    const { behavior, fewshotKey } = resolveDomain(m.domain, knowledgeDomains);
    return {
      domain: m.domain,
      behavior,
      fewshotKey,
      matchedTopic: m.matchedTopic,
      isFromCache: false,
      isFromFallback: false,
    };
  };

  const trimmed = text.trim();

  // ① キーワード一致(即時・正確)
  const kw = classifyByKeyword(trimmed, knowledgeDomains);
  if (kw) {
    log.info(`local router: keyword domain=${kw.domain}`);
    return make(kw);
  }

  // ② 埋め込み類似(言い換え)。短すぎる発話・モデル未配置はスキップ。
  if (trimmed.length >= ROUTER_EMBED_MIN_CHARS) {
    try {
      const available = deps.embeddingAvailable ?? isEmbeddingModelAvailable;
      if (await available()) {
        const embedder = deps.embedder ?? getDefaultEmbedder();
        const em = await classifyByEmbedding(trimmed, knowledgeDomains, embedder, deps.simThreshold);
        if (em) {
          log.info(`local router: embed domain=${em.domain} sim=${em.score.toFixed(2)}`);
          return make(em);
        }
      }
    } catch (e) {
      log.warn(`local router embedding failed: ${(e as Error).name}`);
    }
  }

  // ③ 迷ったら medium(保守)
  return buildFallbackResult(knowledgeDomains);
}

/**
 * 起動時ウォーム(B-15)。topics の document 埋め込みを先に温める(初回ターンの遅延・embed 競合回避)。
 * best-effort:モデル未配置なら何もしない。失敗しても会話に影響しない。
 */
export async function warmLocalRouter(knowledgeDomains: CharacterKnowledgeDomains): Promise<void> {
  try {
    if (!(await isEmbeddingModelAvailable())) return;
    await getTopicVectors(knowledgeDomains, getDefaultEmbedder());
    log.info('local router topics warmed');
  } catch (e) {
    log.warn('local router warm failed', { name: (e as Error).name });
  }
}

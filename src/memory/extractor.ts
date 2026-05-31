import { nowLocalIso } from '../shared/datetime';
import {
  EPISODIC_SUMMARY_MAX_CHARS,
  IMPORTANCE_MIN,
  IMPORTANCE_MAX,
  IMPORTANCE_DEFAULT,
} from '../shared/constants';
import { validateSemanticPatch } from './schema-validation';
import type { EpisodicMemory, SemanticMemory, ShortTermEntry } from '../shared/types/memory';

// 会話からの記憶抽出(設計書 §3.3)。
//
// 抽出は「中立的な観察者」として動作し、キャラ口調を混ぜない(task_03 禁止事項)。
// Claude の呼び出しは依存性注入(LlmComplete)で受け取り、Conversation Layer(task_05)が
// 実装を渡す。これにより task_03 が task_05 の Claude クライアントへ前方依存しない。

/** LLM へ 1 回問い合わせて生テキストを返す関数(Conversation Layer が実装を注入)。 */
export type LlmComplete = (req: {
  system: string;
  user: string;
  maxTokens?: number;
}) => Promise<string>;

export interface ExtractionResult {
  episodic?: EpisodicMemory;
  semanticPatch?: Partial<SemanticMemory>;
}

const EXTRACTION_SYSTEM = [
  '以下の会話から、ユーザーについて長期的に意味のある事実・嗜好・出来事を抽出してください。',
  'あなたは中立的な観察者です。特定のキャラクターの口調や人格は一切反映しないでください。',
  '',
  '出力は次の JSON 形式のみ(前後に文章を付けない):',
  '{"episodic": {"topic": string, "summary": string, "tags": string[], "importance": number, "category": string} | null,',
  ' "semanticPatch": {"userName"?: string, "preferences"?: object, "longTermGoals"?: string[], "personality"?: string[], "extra"?: object} | null}',
  '',
  '抽出基準:',
  '- 一過性の話題ではなく、長期的に意味のある情報のみ。該当しなければ null。',
  `- summary は ${EPISODIC_SUMMARY_MAX_CHARS} 文字以内。`,
  `- importance は ${IMPORTANCE_MIN}(些細)〜${IMPORTANCE_MAX}(極めて重要)の整数。`,
  '- category は health / work / hobby / relationship / general などの短い英単語。',
].join('\n');

/** コードフェンス・前後テキストを除去して最初の JSON オブジェクトを抽出・パースする。 */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  text = text.slice(first, last + 1);
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function clampImportance(v: unknown): number {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  if (Number.isNaN(n)) return IMPORTANCE_DEFAULT;
  return Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, n));
}

function normalizeEpisodic(raw: Record<string, unknown>): EpisodicMemory {
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [];
  return {
    // date は抽出時刻(ローカルTZ込み)をこちらで付与する(LLM の値は信用しない)。
    date: nowLocalIso(),
    topic: typeof raw.topic === 'string' ? raw.topic : '',
    summary: summary.slice(0, EPISODIC_SUMMARY_MAX_CHARS),
    tags,
    importance: clampImportance(raw.importance),
    category: typeof raw.category === 'string' && raw.category.length > 0 ? raw.category : 'general',
  };
}

export async function extractMemoryFromConversation(
  unextractedEntries: ShortTermEntry[],
  complete: LlmComplete,
): Promise<ExtractionResult> {
  if (unextractedEntries.length === 0) return {};

  const conversation = unextractedEntries
    .map((e) => `${e.role === 'user' ? 'ユーザー' : '相手'}: ${e.text}`)
    .join('\n');

  let raw: string;
  try {
    raw = await complete({ system: EXTRACTION_SYSTEM, user: conversation, maxTokens: 1024 });
  } catch {
    // 抽出失敗は会話を妨げない(ベストエフォート・NF-REL-02)。
    return {};
  }

  const parsed = parseJsonObject(raw);
  if (!parsed) return {};

  const result: ExtractionResult = {};
  if (parsed.episodic && typeof parsed.episodic === 'object' && !Array.isArray(parsed.episodic)) {
    result.episodic = normalizeEpisodic(parsed.episodic as Record<string, unknown>);
  }
  if (parsed.semanticPatch && typeof parsed.semanticPatch === 'object') {
    const patch = validateSemanticPatch(parsed.semanticPatch);
    if (Object.keys(patch).length > 0) {
      result.semanticPatch = patch;
    }
  }
  return result;
}

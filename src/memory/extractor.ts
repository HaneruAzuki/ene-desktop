import { nowLocalIso } from '../shared/datetime';
import {
  EPISODIC_SUMMARY_MAX_CHARS,
  EPISODIC_SCHEMA_VERSION,
  IMPORTANCE_MIN,
  IMPORTANCE_MAX,
  IMPORTANCE_DEFAULT,
} from '../shared/constants';
import { validateSemanticPatch } from './schema-validation';
import type {
  Correction,
  EpisodicMemory,
  EpisodicRecord,
  SemanticMemory,
  ShortTermEntry,
} from '../shared/types/memory';

// 会話からの記憶抽出(設計書 §3.3 / task_15)。
//
// 抽出は「中立的な観察者」として動作し、キャラ口調を混ぜない(task_03 禁止事項)。
// task_15 で2点拡張:
//  - entities(登場人物・固有名を canonical 正規化した配列)を抽出。
//  - relevantMemories(想起した旧記憶)と矛盾/精緻化を検知し、確信が高い時のみ corrections を出力。
// Claude の呼び出しは依存性注入(LlmComplete)で受け取り、Conversation Layer(task_05)が実装を渡す。

/** LLM へ 1 回問い合わせて生テキストを返す関数(Conversation Layer が実装を注入)。 */
export type LlmComplete = (req: {
  system: string;
  user: string;
  maxTokens?: number;
}) => Promise<string>;

export interface ExtractionResult {
  episodic?: EpisodicMemory;
  semanticPatch?: Partial<SemanticMemory>;
  corrections?: Correction[];
}

const CORRECTION_KINDS = ['supersede', 'refine', 'reattribute'] as const;

const EXTRACTION_SYSTEM = [
  '以下の会話から、ユーザーについて長期的に意味のある事実・嗜好・出来事を抽出してください。',
  'あなたは中立的な観察者です。特定のキャラクターの口調や人格は一切反映しないでください。',
  '',
  '出力は次の JSON 形式のみ(前後に文章を付けない):',
  '{"episodic": {"topic": string, "summary": string, "tags": string[], "entities": string[], "importance": number, "category": string} | null,',
  ' "semanticPatch": {"userName"?: string, "preferences"?: object, "longTermGoals"?: string[], "personality"?: string[], "extra"?: object} | null,',
  ' "corrections": [{"targetFile": string, "kind": "supersede"|"refine"|"reattribute", "newSummary"?: string, "newEntities"?: string[], "reason"?: string}] }',
  '',
  '抽出基準:',
  '- 一過性の話題ではなく、長期的に意味のある情報のみ。該当しなければ episodic は null。',
  `- summary は ${EPISODIC_SUMMARY_MAX_CHARS} 文字以内。ENE の立場や情報の出所も summary に文章として織り込む`,
  '  (例:「ユーザーは…と言った。ENEは反対した。」「田中さんから聞いた話では…」)。専用フィールドは作らない。',
  `- importance は ${IMPORTANCE_MIN}(些細)〜${IMPORTANCE_MAX}(極めて重要)の整数。`,
  '- category は health / work / hobby / relationship / general などの短い英単語。',
  '- entities: 会話に登場する人物・固有名を列挙し、代表表記(canonical)に正規化する。',
  '  同一人物の表記ゆれ(例「田中」「田中さん」「田中一郎」)は1つにまとめる。人物を優先。無ければ []。',
  '  例: ユーザーが「田中さんと喧嘩した」→ entities: ["田中"]。',
  '',
  '記憶の更新(corrections):',
  '- 末尾に「関連する既存の記憶」を id 付きで渡す。新しい会話がそれと矛盾・精緻化する場合のみ corrections を出す。',
  '- targetFile には該当する既存記憶の id をそのまま使う。',
  '- kind: 事実が置き換わった=supersede / 内容を詳しくした=refine / 人物を取り違えていた=reattribute。',
  '- 確信が持てない場合は corrections を出さない(空配列か省略)。推測で過去を書き換えない。',
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

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function normalizeEpisodic(raw: Record<string, unknown>): EpisodicMemory {
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  return {
    schemaVersion: EPISODIC_SCHEMA_VERSION,
    // date は抽出時刻(ローカルTZ込み)をこちらで付与する(LLM の値は信用しない)。
    date: nowLocalIso(),
    topic: typeof raw.topic === 'string' ? raw.topic : '',
    summary: summary.slice(0, EPISODIC_SUMMARY_MAX_CHARS),
    tags: stringArray(raw.tags),
    entities: stringArray(raw.entities),
    importance: clampImportance(raw.importance),
    category: typeof raw.category === 'string' && raw.category.length > 0 ? raw.category : 'general',
  };
}

/** corrections を検証・正規化する(不正な要素は捨てる)。 */
function normalizeCorrections(raw: unknown): Correction[] {
  if (!Array.isArray(raw)) return [];
  const out: Correction[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    const kind = c.kind;
    if (typeof c.targetFile !== 'string' || c.targetFile.length === 0) continue;
    if (typeof kind !== 'string' || !(CORRECTION_KINDS as readonly string[]).includes(kind)) continue;
    const correction: Correction = {
      targetFile: c.targetFile,
      kind: kind as Correction['kind'],
    };
    if (typeof c.newSummary === 'string') correction.newSummary = c.newSummary;
    if (Array.isArray(c.newEntities)) correction.newEntities = stringArray(c.newEntities);
    if (typeof c.reason === 'string') correction.reason = c.reason;
    out.push(correction);
  }
  return out;
}

/** 想起した旧記憶を抽出プロンプトに載せる文面を作る(corrections の targetFile 参照用)。 */
function formatRelevantMemories(relevantMemories: EpisodicRecord[]): string {
  if (relevantMemories.length === 0) return '';
  const lines = relevantMemories.map(
    ({ id, memory }) => `- id: ${id}\n  summary: ${memory.summary}`,
  );
  return ['', '関連する既存の記憶(矛盾・精緻化があれば corrections で参照):', ...lines].join('\n');
}

export async function extractMemoryFromConversation(
  unextractedEntries: ShortTermEntry[],
  relevantMemories: EpisodicRecord[],
  complete: LlmComplete,
): Promise<ExtractionResult> {
  if (unextractedEntries.length === 0) return {};

  const conversation = unextractedEntries
    .map((e) => `${e.role === 'user' ? 'ユーザー' : '相手'}: ${e.text}`)
    .join('\n');
  const user = conversation + formatRelevantMemories(relevantMemories);

  let raw: string;
  try {
    raw = await complete({ system: EXTRACTION_SYSTEM, user, maxTokens: 1024 });
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
  const corrections = normalizeCorrections(parsed.corrections);
  if (corrections.length > 0) {
    result.corrections = corrections;
  }
  return result;
}

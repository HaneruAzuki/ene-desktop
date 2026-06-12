import { EPISODIC_SUMMARY_MAX_CHARS } from '../shared/constants';
import { extractJsonObject, toStringArray } from '../shared/llm-parse';
import type { EpisodicRecord } from '../shared/types/memory';
import type { LlmComplete } from './extractor';

// 期間サマリ生成(忘却機構・§11.6)。月次/年次に、その期間の記録を1件のサマリへ再要約する。
// 抽出器と同じく「中立的な観察者」として動作し、キャラ口調を混ぜない(task_03 禁止事項)。
// LLM は DI(LlmComplete)。Memory 層は Claude を直接知らない(疎結合・§4.4)。

export interface PeriodSummary {
  summary: string;
  topic: string;
  tags: string[];
  entities: string[];
}

/** 応答テキストから最初の JSON オブジェクトを取り出してパースする(失敗は throw)。 */
function parsePeriodSummary(raw: string): PeriodSummary {
  // 抽出失敗時は throw する(呼出側は削除を行わず記録を温存する)。
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('summary: no JSON object in response');
  }
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj['summary'] === 'string' ? obj['summary'].trim() : '';
  if (!summary) throw new Error('summary: empty summary');
  const topic = typeof obj['topic'] === 'string' && obj['topic'].trim() ? obj['topic'].trim() : '';
  return {
    summary: summary.slice(0, EPISODIC_SUMMARY_MAX_CHARS),
    topic: topic || 'まとめ',
    tags: toStringArray(obj['tags']).slice(0, 12),
    entities: toStringArray(obj['entities']).slice(0, 20),
  };
}

const SYSTEM = [
  'あなたは記憶を圧縮する中立的な観察者です。キャラクターの口調や一人称は使いません。',
  '与えられた期間の複数の記憶を、後から思い出す手がかりとして1つに要約してください。',
  '重要な出来事・関係の変化・繰り返し現れた話題・約束を優先し、些末な反復は省きます。',
  '事実を保ち、無い情報を創作しないこと。',
  '出力は次の JSON のみ(前後に文章を付けない):',
  '{"summary": "200文字以内の日本語要約", "topic": "短い見出し", "tags": ["語"], "entities": ["人物や固有名"]}',
].join('\n');

/**
 * 期間の記録群を1つのサマリへ再要約する。失敗時は throw(呼出側は削除を行わず記録を温存する)。
 * @param records 対象期間の記録(生記録 ＋ 巻き上げ対象の下位サマリ)。
 * @param periodLabel 期間の見出し(例 "2026年5月" / "2026年")。
 */
export async function summarizePeriod(
  records: EpisodicRecord[],
  periodLabel: string,
  complete: LlmComplete,
): Promise<PeriodSummary> {
  const lines = records.map((r) => {
    const m = r.memory;
    const ents = m.entities && m.entities.length > 0 ? ` [${m.entities.join(',')}]` : '';
    return `- (${m.date.slice(0, 10)}・重要度${m.importance}) ${m.summary}${ents}`;
  });
  const user = [
    `期間: ${periodLabel}`,
    `記憶 ${records.length} 件:`,
    ...lines,
    '',
    'この期間を1つに要約した JSON を返してください。',
  ].join('\n');

  const raw = await complete({ system: SYSTEM, user, maxTokens: 700 });
  return parsePeriodSummary(raw);
}

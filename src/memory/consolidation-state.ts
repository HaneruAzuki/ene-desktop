import { getConsolidationStatePath } from '../storage/paths';
import { readJson, writeJson } from '../storage/json-store';

// 忘却機構の実行記録(§11.6)。最後にいつ統合(月次/年次)を回したかを残し、
// 起動時に「未処理の期間があるか」を判定する材料にする(状態は最小・平文 JSON・§6.1)。
// ※ 実際に「その期間が統合済みか」はサマリ記録の有無で冪等に判定する(本ファイルは補助情報)。

export interface ConsolidationState {
  /** 最後に忘却機構を実行したローカル ISO 日時(無ければ null=未実行)。 */
  lastRun: string | null;
  /** 直近の実行で削除した記録数(運用観測用・任意)。 */
  lastDeletedCount?: number;
  /** 直近の実行で作成したサマリ数(運用観測用・任意)。 */
  lastSummaryCount?: number;
}

export async function getConsolidationState(): Promise<ConsolidationState> {
  return (await readJson<ConsolidationState>(getConsolidationStatePath())) ?? { lastRun: null };
}

export async function saveConsolidationState(state: ConsolidationState): Promise<void> {
  await writeJson(getConsolidationStatePath(), state);
}

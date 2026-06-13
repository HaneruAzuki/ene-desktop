import {
  FORGET_MONTHLY_DELETE_IMPORTANCE_MAX,
  FORGET_YEARLY_DELETE_IMPORTANCE_MAX,
  FORGET_YEARLY_AGE_YEARS,
  FORGET_DAILY_LIFE_MIN_AGE_MONTHS,
  DAILY_LIFE_CATEGORY,
} from '../shared/constants';
import type { EpisodicRecord } from '../shared/types/memory';

// 忘却の「計画」を立てる純粋ロジック(§11.6・段階的記憶縮退)。I/O も LLM も持たない=決定論で単体テスト可能。
// 実際の要約(LLM)・物理削除・索引更新は orchestrator(forgetting.ts)が本計画を実行する。
//
// 段階的縮退(§11.6):
//   直近1ヶ月: 全詳細(当月は触らない)
//     ↓ 月次サマリ(完了した月)→ importance≤2 を削除・≥3 の詳細は残す
//   1ヶ月〜1年: 重要度≥3 詳細 + 月次サマリ
//     ↓ 年次サマリ(currentYear-Y ≥ 2 の年)→ 月次サマリを巻き上げ・importance≤3 を削除・≥4 を残す
//   1〜5年: 重要度≥4 詳細 + 年次サマリ
//
// canon(provenance:'self')は忘却対象外。サマリ記録(extra.summaryTier)は段階に応じて扱いを変える。

/** サマリ記録の段(無ければ生記録)。 */
export type SummaryTier = 'monthly' | 'yearly';

export interface MonthlyPlan {
  period: string; // "YYYY-MM"
  year: number;
  month: number;
  toSummarize: EpisodicRecord[]; // その月の生 user 記録(サマリ除く)
  toDelete: string[]; // 物理削除する記録 ID(importance ≤ 月次しきい値)
}

export interface YearlyPlan {
  year: number;
  toSummarize: EpisodicRecord[]; // その年の月次サマリ ＋ 残存生記録
  toDelete: string[]; // 月次サマリ全部 ＋ 生記録 importance ≤ 年次しきい値
}

export interface ConsolidationPlan {
  monthly: MonthlyPlan[];
  yearly: YearlyPlan[];
  /**
   * 暮らしの断片(daily-life・provenance:'self')のうち、要約せず直接削除する記録 ID(B-18 / N-PRES-3)。
   * canon と違い「平凡な日は薄れる」=user サマリに巻き上げず、十分古い(FORGET_DAILY_LIFE_MIN_AGE_MONTHS 以上)
   * かつ低importance(≤ 月次しきい値)のものだけ消す。当月・直近月は連続性のため残す。
   */
  dailyLifeDelete: string[];
}

function yearOf(r: EpisodicRecord): number {
  return parseInt(r.memory.date.slice(0, 4), 10);
}

function monthOf(r: EpisodicRecord): number {
  return parseInt(r.memory.date.slice(5, 7), 10);
}

/** record の月から now までの経過月数(年跨ぎ込み)。 */
function monthsAgo(year: number, month: number, now: { year: number; month: number }): number {
  return (now.year - year) * 12 + (now.month - month);
}

function periodOf(r: EpisodicRecord): string {
  return r.memory.date.slice(0, 7); // "YYYY-MM"
}

function tierOf(r: EpisodicRecord): SummaryTier | undefined {
  const t = r.memory.extra?.['summaryTier'];
  return t === 'monthly' || t === 'yearly' ? t : undefined;
}

function isUser(r: EpisodicRecord): boolean {
  return (r.memory.provenance ?? 'user') !== 'self';
}

/** その月が「完了済み」(当月より前)か。当月・未来は対象外(直近は触らない)。 */
function isCompletedMonth(year: number, month: number, now: { year: number; month: number }): boolean {
  return year < now.year || (year === now.year && month < now.month);
}

function groupBy<K>(items: EpisodicRecord[], key: (r: EpisodicRecord) => K): Map<K, EpisodicRecord[]> {
  const map = new Map<K, EpisodicRecord[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k) ?? [];
    list.push(it);
    map.set(k, list);
  }
  return map;
}

/**
 * 忘却計画を立てる(純粋)。
 * @param records 全 episodic 記録(サマリ含む。canon は内部で除外)。
 * @param now 現在のローカル年月(注入=決定論)。
 */
export function planConsolidation(
  records: EpisodicRecord[],
  now: { year: number; month: number },
): ConsolidationPlan {
  const user = records.filter(isUser);

  // --- 年次: currentYear - Y ≥ FORGET_YEARLY_AGE_YEARS かつ 年次サマリ未作成の年 ---
  const yearly: YearlyPlan[] = [];
  for (const [year, recs] of groupBy(user, yearOf)) {
    if (now.year - year < FORGET_YEARLY_AGE_YEARS) continue; // まだ若い(月次帯)
    if (recs.some((r) => tierOf(r) === 'yearly')) continue; // 既に年次サマリあり=済み
    // 巻き上げ素材 = 月次サマリ ＋ 残存生記録。年次サマリ自身は除く。
    const toSummarize = recs.filter((r) => tierOf(r) !== 'yearly');
    if (toSummarize.length === 0) continue;
    const toDelete = recs
      .filter(
        (r) =>
          tierOf(r) === 'monthly' || // 月次サマリは年次へ巻き上げ後に削除
          (tierOf(r) === undefined &&
            r.memory.importance <= FORGET_YEARLY_DELETE_IMPORTANCE_MAX),
      )
      .map((r) => r.id);
    yearly.push({ year, toSummarize, toDelete });
  }

  // --- 月次: 完了した月で、月次サマリ未作成、かつ年次対象でない年の月 ---
  const monthly: MonthlyPlan[] = [];
  for (const [period, recs] of groupBy(user, periodOf)) {
    const year = parseInt(period.slice(0, 4), 10);
    const month = parseInt(period.slice(5, 7), 10);
    if (!isCompletedMonth(year, month, now)) continue; // 当月・未来は触らない
    if (now.year - year >= FORGET_YEARLY_AGE_YEARS) continue; // 年次が扱う(月次はしない)
    if (recs.some((r) => tierOf(r) === 'monthly')) continue; // 月次サマリ済み
    const rawRecs = recs.filter((r) => tierOf(r) === undefined);
    if (rawRecs.length === 0) continue; // 生記録が無ければ何もしない
    const toDelete = rawRecs
      .filter((r) => r.memory.importance <= FORGET_MONTHLY_DELETE_IMPORTANCE_MAX)
      .map((r) => r.id);
    monthly.push({ period, year, month, toSummarize: rawRecs, toDelete });
  }

  // --- 暮らしの断片(daily-life)の縮退(B-18)。canon は forgetting の入力に入らない=ここの self は daily-life のみ。 ---
  // user サマリに混ぜると provenance が汚れる(自分の生活が「相手のこと」に化ける)ため、要約せず直接削除する。
  // 当月＋直近月(< FORGET_DAILY_LIFE_MIN_AGE_MONTHS)は「昨日/最近」の連続性のため残し、それ以上の低importanceを消す。
  const dailyLifeDelete = records
    .filter((r) => r.memory.provenance === 'self' && r.memory.category === DAILY_LIFE_CATEGORY)
    .filter((r) => monthsAgo(yearOf(r), monthOf(r), now) >= FORGET_DAILY_LIFE_MIN_AGE_MONTHS)
    .filter((r) => r.memory.importance <= FORGET_MONTHLY_DELETE_IMPORTANCE_MAX)
    .map((r) => r.id);

  return { monthly, yearly, dailyLifeDelete };
}

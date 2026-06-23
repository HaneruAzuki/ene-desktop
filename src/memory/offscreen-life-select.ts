import {
  DAILY_LIFE_CATEGORY,
  DAILY_LIFE_IMPORTANCE,
  EPISODIC_SUMMARY_MAX_CHARS,
  EPISODIC_SCHEMA_VERSION,
} from '../shared/constants';
import type { EpisodicMemory } from '../shared/types/memory';
import type { OffscreenBeat, OffscreenLifePack } from '../shared/types/offscreen-life';

// 画面の外の暮らし: 週次 beat の「選択」純粋ロジック(I/O なし=決定論で単体テスト可能)。
// 実際のロード(memory/offscreen-life-pack)・保存(app/main の配線)とは分離する(electron 非依存に保つ)。
//
// フォールバックの段(plan §12):
//   ① 今週ぶんの authored beat があれば使う
//   ② 無いが最新の authored が猶予内 → 保持(常緑に落とさない・新作待ち)=吸収しない(null)
//   ③ 猶予超(or authored 不在) → 常緑年を週-of-year で語り直す(永久の床)
//   ④ なし(quiet)=null
// canon と同じく provenance:'self'。null のときも挨拶は既存の直近記憶で成立する。

/** 「最新の authored がこの週数以内なら新作待ちで保持」する既定の猶予(約2四半期)。 */
export const DEFAULT_GRACE_WEEKS = 26;

/** 「YYYY-Www」を比較可能な序数へ(年跨ぎの猶予計算用・厳密でなくてよい)。 */
function weekOrdinal(isoWeek: string): number {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(isoWeek);
  if (m === null) return 0;
  return Number(m[1]) * 53 + Number(m[2]);
}

/** seasonal パック群の中で最も新しい(序数最大の)ISO週を返す。無ければ null。 */
function newestSeasonalWeek(seasonal: OffscreenLifePack[]): string | null {
  let best: string | null = null;
  let bestOrd = -Infinity;
  for (const p of seasonal) {
    for (const b of p.beats) {
      if (typeof b.week !== 'string') continue;
      const o = weekOrdinal(b.week);
      if (o > bestOrd) {
        bestOrd = o;
        best = b.week;
      }
    }
  }
  return best;
}

/** 常緑年から、週-of-year に対応する beat を選ぶ(当該週以前で最大、無ければ年内最大=ラップ)。 */
function pickEvergreenBeat(evergreen: OffscreenLifePack, weekOfYear: number): OffscreenBeat | null {
  let atOrBefore: OffscreenBeat | null = null;
  let atOrBeforeW = -1;
  let latest: OffscreenBeat | null = null;
  let latestW = -1;
  for (const b of evergreen.beats) {
    if (typeof b.week !== 'number') continue;
    if (b.week > latestW) {
      latestW = b.week;
      latest = b;
    }
    if (b.week <= weekOfYear && b.week > atOrBeforeW) {
      atOrBeforeW = b.week;
      atOrBefore = b;
    }
  }
  return atOrBefore ?? latest;
}

export interface BeatSelection {
  beat: OffscreenBeat;
  source: 'authored' | 'evergreen';
}

/**
 * 今週「吸収する」beat を選ぶ(純粋)。null = 吸収しない(保持/quiet)。
 * @param graceWeeks 最新の authored がこの週数以内なら新作待ちで保持(常緑に落とさない)。
 */
export function selectWeeklyBeat(
  packs: OffscreenLifePack[],
  isoWeek: string,
  weekOfYear: number,
  graceWeeks: number = DEFAULT_GRACE_WEEKS,
): BeatSelection | null {
  const seasonal = packs.filter((p) => p.kind === 'seasonal');
  const evergreen = packs.find((p) => p.kind === 'evergreen') ?? null;

  // ① 今週ぶんの authored beat。
  for (const p of seasonal) {
    const b = p.beats.find((bt) => bt.week === isoWeek);
    if (b) return { beat: b, source: 'authored' };
  }

  // ② 最新の authored がまだ新しい(猶予内) → 保持(常緑に行かない)。
  const newest = newestSeasonalWeek(seasonal);
  if (newest !== null) {
    const gap = weekOrdinal(isoWeek) - weekOrdinal(newest);
    if (gap >= 0 && gap <= graceWeeks) return null;
  }

  // ③ 猶予超(or authored 不在) → 常緑年(永久の床)。
  if (evergreen) {
    const b = pickEvergreenBeat(evergreen, weekOfYear);
    if (b) return { beat: b, source: 'evergreen' };
  }

  // ④ なし(quiet)。
  return null;
}

/** OffscreenBeat を保存用 EpisodicMemory(provenance:'self')へ変換する(date は呼出側が「今」を渡す)。 */
export function beatToEpisodic(beat: OffscreenBeat, dateIso: string): EpisodicMemory {
  const memory: EpisodicMemory = {
    schemaVersion: EPISODIC_SCHEMA_VERSION,
    date: dateIso,
    topic: beat.topic,
    summary: beat.summary.slice(0, EPISODIC_SUMMARY_MAX_CHARS),
    tags: beat.tags ?? [],
    entities: beat.entities ?? [],
    importance: beat.importance ?? DAILY_LIFE_IMPORTANCE,
    category: beat.category ?? DAILY_LIFE_CATEGORY,
    provenance: 'self',
    disclosureLevel: beat.disclosureLevel ?? 1,
  };
  if (beat.openLoop) memory.openLoop = beat.openLoop;
  return memory;
}

import {
  DAY_MS,
  TIME_OF_DAY_BANDS,
  TIME_OF_DAY_LATE_NIGHT,
  LONG_ABSENCE_DAYS,
  FATIGUE_TURN_THRESHOLD,
  IDLE_TALK_QUIET_HOURS,
} from './constants';

// 「いま」の存在文脈を組み立てる純粋関数(P1/P7・N-PRES-1 / N-PRES-7)。
// 現在時刻・前回会話からの経過・有限性のトーンを、キャラ非依存のデータ/指示文に変換する。
// I/O は持たない=決定論で単体テスト可能。整形(プロンプト文面)は prompt-builder 側。
// shared に置く理由:純粋な時間ユーティリティ(datetime.ts と同層)で、memory→shared の正方向で参照できる。

/** 時刻(0-23)→ 時間帯ラベル(朝/昼/夕方/夜/深夜)。境界は TIME_OF_DAY_BANDS。 */
export function timeOfDayLabel(hour: number): string {
  let label = TIME_OF_DAY_LATE_NIGHT; // 0〜4時台の既定(下の表で拾えない早朝帯)
  for (const band of TIME_OF_DAY_BANDS) {
    if (hour >= band.from) label = band.label;
  }
  return label;
}

/** "YYYY-MM-DD..." をローカル Date(その日の0時)に。不正は null。 */
function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 前回会話日(YYYY-MM-DD)から今日までの経過日数。未指定・不正・負(時計巻き戻り)は null。 */
export function elapsedDays(lastDate: string | undefined, today: string): number | null {
  if (!lastDate) return null;
  const a = parseYmd(lastDate);
  const b = parseYmd(today);
  if (!a || !b) return null;
  const diff = Math.round((b.getTime() - a.getTime()) / DAY_MS);
  return diff >= 0 ? diff : null;
}

/**
 * 経過の言葉(P1)。同日(0)・初回(null)は undefined=「いま」に経過行を出さない。
 * 1=昨日ぶり、N=N日ぶり、LONG_ABSENCE_DAYS 以上=「しばらく会っていない」を添える。
 */
export function describeElapsed(lastDate: string | undefined, today: string): string | undefined {
  const d = elapsedDays(lastDate, today);
  if (d == null || d === 0) return undefined;
  if (d === 1) return '昨日ぶり';
  if (d >= LONG_ABSENCE_DAYS) return `${d}日ぶり(しばらく会っていない)`;
  return `${d}日ぶり`;
}

/**
 * 有限性のトーン指示(P7・**発言内容のみ**。声のパラメータは変えない)。
 * 状態は一切保存しない=現在時刻とセッション内ターン数からその場で導出する(§5.3 適合)。
 *  - 深夜帯(IDLE_TALK_QUIET_HOURS): 眠そうな素振り・相手に休息を促す言い方を許可。
 *  - 長時間会話(FATIGUE_TURN_THRESHOLD 超): 少し疲れた素振りを許可(会話は切り上げない)。
 */
export function finitenessHint(hour: number, turnsThisSession: number): string | undefined {
  const inQuiet = hour >= IDLE_TALK_QUIET_HOURS.from || hour < IDLE_TALK_QUIET_HOURS.to;
  if (inQuiet) {
    return '(いまは夜遅い時間。少し眠そうな素振りや、相手にも早く休むよう促す言い方をしてよい。声ではなく言葉で。)';
  }
  if (turnsThisSession >= FATIGUE_TURN_THRESHOLD) {
    return '(ずいぶん長く話している。少し疲れた素振りを見せてよい。ただし会話を切り上げる必要はない。)';
  }
  return undefined;
}

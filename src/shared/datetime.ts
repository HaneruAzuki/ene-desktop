// 日時ユーティリティ(設計書 §5.6「日時表現の規約」)。
//
// すべての日時は「ローカルタイム + タイムゾーンオフセット込み」の ISO 8601 で表現する。
// UTC(末尾 Z)表記は使わない(誕生日判定や記憶の日付がユーザー体感とズレるため)。
//
// 📌 時刻取得が必要な箇所では必ず本ファイルの関数を経由すること。
//    `new Date().toISOString()`(UTC を返す)を直接呼ぶことは禁止(設計書 §5.6)。

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function tzOffset(d: Date): string {
  // getTimezoneOffset() は「UTC - ローカル」を分で返す(日本なら -540)。
  // ISO のオフセットは符号が逆になるため反転する。
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? '+' : '-';
  const abs = Math.abs(tzMin);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** 現在のローカル時刻を ISO 8601 + TZ オフセット形式で返す(例: 2026-05-10T17:30:00+09:00)。 */
export function nowLocalIso(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    tzOffset(d)
  );
}

/**
 * ファイル名用の現在時刻(例: 2026-05-10T17-30-00)。
 * Windows のファイル名制約のため `:` を `-` に置換し、TZ オフセットは省略する。
 * JSON 内のフィールドには必ず TZ 込みの {@link nowLocalIso} を使うこと。
 */
export function nowLocalIsoForFilename(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

/** ローカル日付の「今日」(YYYY/MM/DD の数値)を返す(誕生日判定用)。 */
export function todayLocalYmd(): { year: number; month: number; day: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * 指定した年月日時のローカル ISO 8601 + TZ オフセットを返す(忘却サマリの合成日付など)。
 * 例: localIsoFromParts(2026, 5, 15) → "2026-05-15T00:00:00+09:00"。
 * `new Date(y, mo-1, d, ...)` はローカル時刻として解釈されるため §5.6 に適合する。
 */
export function localIsoFromParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): string {
  const d = new Date(year, month - 1, day, hour, minute, second);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    tzOffset(d)
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ローカル日付の ISO 8601 週情報を返す(画面の外の暮らしの週次キー・off-screen-life)。
 * - 週は月曜始まり。週が属する年は「その週の木曜が属する年」(ISO 8601)。
 * - isoWeek 例 "2026-W30"、weekOfYear は 1..53。
 * UTC を使わずローカルの暦日で計算する(§5.6)。
 */
export function isoWeekParts(d: Date): { isoWeek: string; weekOfYear: number; isoYear: number } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (date.getDay() + 6) % 7; // 月=0 .. 日=6
  date.setDate(date.getDate() - dow + 3); // この週の木曜
  const isoYear = date.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4); // 1/4 は必ず第1週に含まれる
  const fdow = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - fdow + 3); // 第1週の木曜
  const weekOfYear = 1 + Math.round((date.getTime() - firstThursday.getTime()) / WEEK_MS);
  return { isoWeek: `${isoYear}-W${pad(weekOfYear)}`, weekOfYear, isoYear };
}

/** 現在のローカル週の ISO 週情報(off-screen-life の毎週の表示単位)。 */
export function currentIsoWeekParts(): { isoWeek: string; weekOfYear: number; isoYear: number } {
  return isoWeekParts(new Date());
}

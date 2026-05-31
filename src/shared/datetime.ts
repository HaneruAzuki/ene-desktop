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

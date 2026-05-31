import type { CharacterIdentity, ActiveCharacter } from '../shared/types/character';

// 誕生日判定(設計書 §3.1)。
// 「不機嫌度」などの感情パラメータは持たず、「祝われた / 祝われていない」の
// 二値の事実(active.birthdayHistory)だけを参照する(CLAUDE §5.3)。
//
// 月は 1-indexed の todayLocal を受け取る(new Date().getMonth() の 0-indexed をここに渡さないこと)。
// todayLocal は src/shared/datetime.ts の todayLocalYmd() から取得する想定。

export function checkBirthday(
  identity: CharacterIdentity,
  active: ActiveCharacter,
  todayLocal: { year: number; month: number; day: number },
): 'today' | 'forgotten' | null {
  const bday = identity.birthday;
  if (!bday) {
    return null; // 誕生日未設定キャラ
  }

  const isToday = todayLocal.month === bday.month && todayLocal.day === bday.day;
  if (isToday) {
    return 'today';
  }

  // 今年の誕生日が既に過ぎているか(同年内の月日比較)
  const isAfterBirthday =
    todayLocal.month > bday.month ||
    (todayLocal.month === bday.month && todayLocal.day > bday.day);

  if (isAfterBirthday) {
    const thisYear = active.birthdayHistory.find((h) => h.year === todayLocal.year);
    if (!thisYear?.celebrated) {
      return 'forgotten'; // 過ぎたのに未祝福
    }
  }

  return null;
}

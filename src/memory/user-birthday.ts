import type { SemanticMemory, UserBirthday } from '../shared/types/memory';
import type { ActiveCharacter } from '../shared/types/character';

// 相手(ユーザー)の誕生日判定(P5・N-PRES-5)。キャラ誕生日 birthday-checker の鏡像。
// 二値の事実(userBirthdayHistory)だけを見る(§5.3)。誕生日そのものは semantic.userBirthday に持つ。

/**
 * 今日が相手の誕生日で、かつ今年まだ祝っていなければ true(祝うヒントを出してよい)。
 * 祝ったら recordUserBirthdayCelebrated で当年を celebrated にし、当日中の繰り返しを止める。
 */
export function isUserBirthdayToday(
  birthday: UserBirthday | undefined,
  active: ActiveCharacter,
  today: { year: number; month: number; day: number },
): boolean {
  if (!birthday) return false;
  if (today.month !== birthday.month || today.day !== birthday.day) return false;
  const celebrated = active.userBirthdayHistory?.find((h) => h.year === today.year)?.celebrated;
  return !celebrated;
}

/** semantic と active から「今日が相手の誕生日か」を判定する薄いラッパ。 */
export function checkUserBirthdayToday(
  semantic: SemanticMemory,
  active: ActiveCharacter,
  today: { year: number; month: number; day: number },
): boolean {
  return isUserBirthdayToday(semantic.userBirthday, active, today);
}

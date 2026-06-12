import { nowLocalIso } from '../shared/datetime';
import { elapsedDays } from '../shared/moment';
import { LONG_ABSENCE_DAYS } from '../shared/constants';
import type { ActiveCharacter, CharacterContext, FewshotExample } from '../shared/types/character';

// 起動時のキャラ挨拶生成(設計書 §8.7)。
// 文言はすべて fewshot.json 由来(キャラ口調をコードにハードコードしない・CLAUDE §5.4)。
//
// P3(N-PRES-3): 前回会話からの経過で挨拶を棚分けする(同日2回目 / 1〜6日ぶり / 7日以上ぶり)。
// これは**フォールバック**(オフライン・生成失敗時)であり、通常はオフスクリーンライフ生成(LLM)が
// 経過や近況を織り込んだ挨拶を返す。棚分けは経過日数だけで決まる=API 不要・決定論。

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/** 前回会話からの経過に応じた挨拶セットを選ぶ(空のセットは normalGreeting に倒す)。 */
function pickByElapsed(fewshot: CharacterContext['fewshot'], lastDate: string | undefined): FewshotExample[] | null {
  const today = nowLocalIso().slice(0, 10);
  const days = elapsedDays(lastDate, today);
  if (days === 0 && fewshot.sameDayGreeting?.length) return fewshot.sameDayGreeting;
  if (days != null && days >= LONG_ABSENCE_DAYS && fewshot.longAbsenceGreeting?.length) {
    return fewshot.longAbsenceGreeting;
  }
  return fewshot.normalGreeting?.length ? fewshot.normalGreeting : null;
}

export function generateGreeting(active: ActiveCharacter, charContext: CharacterContext): string {
  const fewshot = charContext.fewshot;

  // 初回起動: 自己紹介 + 操作案内(firstLaunchGreeting)
  if (!active.firstLaunchCompleted && fewshot.firstLaunchGreeting?.length) {
    return randomChoice(fewshot.firstLaunchGreeting).assistant;
  }

  // 誕生日を忘れられた翌日以降: 拗ねた反応(forgotten)
  if (charContext.birthdayHint === 'forgotten' && fewshot.birthdayReactions?.forgotten?.length) {
    return randomChoice(fewshot.birthdayReactions.forgotten).assistant;
  }

  // 通常起動: 前回会話からの経過で棚分け(同日 / 1〜6日 / 7日以上)
  const set = pickByElapsed(fewshot, active.relationship?.lastConversationDate);
  if (set) return randomChoice(set).assistant;

  // フォールバック(キャラ非依存の汎用挨拶)
  return '…こんにちは。';
}

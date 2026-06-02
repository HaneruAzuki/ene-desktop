import type { ActiveCharacter, CharacterContext } from '../shared/types/character';

// 起動時のキャラ挨拶生成(設計書 §8.7)。
// 文言はすべて fewshot.json 由来(キャラ口調をコードにハードコードしない・CLAUDE §5.4)。

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
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

  // 通常起動
  if (fewshot.normalGreeting?.length) {
    return randomChoice(fewshot.normalGreeting).assistant;
  }

  // フォールバック(キャラ非依存の汎用挨拶)
  return '…こんにちは。';
}

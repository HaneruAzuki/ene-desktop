import { getActiveCharacterPath } from '../storage/paths';
import { readJson, writeJson } from '../storage/json-store';
import { nowLocalIso } from '../shared/datetime';
import type { ActiveCharacter } from '../shared/types/character';

// active-character.json の管理(設計書 §5.4・最小状態管理)。
// 感情パラメータ等の複雑な状態は持たず、「機能上必要な事実」のみ記録する。

// 初回生成時のデフォルトキャラ ID。設計書 §5.4 で定められた「同梱キャラ」の ID。
// (キャラ属性のハードコードではなく、ブートストラップ時の初期 active キャラ指定)
const DEFAULT_CHARACTER_ID = 'ene';

/**
 * active-character.json を読み込む。存在しなければデフォルト値で生成して保存する。
 */
export async function loadOrCreateActiveCharacter(): Promise<ActiveCharacter> {
  const existing = await readJson<ActiveCharacter>(getActiveCharacterPath());
  if (existing) {
    return existing;
  }
  const created: ActiveCharacter = {
    version: 1,
    characterId: DEFAULT_CHARACTER_ID,
    selectedAt: nowLocalIso(),
    birthdayHistory: [],
    firstLaunchCompleted: false,
  };
  await saveActiveCharacter(created);
  return created;
}

export async function saveActiveCharacter(active: ActiveCharacter): Promise<void> {
  await writeJson(getActiveCharacterPath(), active);
}

/** 初回起動の操作案内を表示し終えたら呼ぶ(冪等)。 */
export async function markFirstLaunchCompleted(): Promise<void> {
  const active = await loadOrCreateActiveCharacter();
  if (!active.firstLaunchCompleted) {
    active.firstLaunchCompleted = true;
    await saveActiveCharacter(active);
  }
}

/** ユーザーが誕生日に触れた時に呼ぶ(該当年を celebrated にする)。 */
export async function recordBirthdayCelebrated(year: number): Promise<void> {
  const active = await loadOrCreateActiveCharacter();
  const entry = active.birthdayHistory.find((h) => h.year === year);
  if (entry) {
    entry.celebrated = true;
    entry.celebratedAt = nowLocalIso();
  } else {
    active.birthdayHistory.push({ year, celebrated: true, celebratedAt: nowLocalIso() });
  }
  await saveActiveCharacter(active);
}

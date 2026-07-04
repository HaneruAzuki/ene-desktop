import {
  getCharacterStatePath,
  getLegacyCharacterStatePath,
} from '../shared/node/paths';
import { readJson, writeJson, deleteJson } from '../shared/node/json-store';
import { CHARACTER_ID } from '../shared/constants';
import { nowLocalIso } from '../shared/datetime';
import type { CharacterState } from '../shared/types/character';

// character-state.json の管理(設計書 §5.4・最小状態管理)。キャラの永続状態(関係の記録)を持つ。
// 感情パラメータ等の複雑な状態は持たず、「機能上必要な事実」のみ記録する。
// キャラ ID は paths.ts の CHARACTER_ID(SSOT)を使う。

/**
 * character-state.json を読み込む。無ければ旧 active-character.json から移行、それも無ければ既定で生成。
 */
export async function loadOrCreateCharacterState(): Promise<CharacterState> {
  const existing = await readJson<CharacterState>(getCharacterStatePath());
  if (existing) {
    return existing;
  }

  // 旧名 active-character.json からの移行(selectedAt→createdAt)。既存ユーザーの関係の記録
  // (会話日数・誕生日履歴・初回完了)を失わないため、初回だけ読み替えて新名へ保存し、旧ファイルは撤去する。
  const legacy = await readJson<Record<string, unknown>>(getLegacyCharacterStatePath());
  if (legacy) {
    const migrated = migrateLegacyState(legacy);
    await saveCharacterState(migrated);
    await deleteJson(getLegacyCharacterStatePath());
    return migrated;
  }

  const created: CharacterState = {
    version: 1,
    characterId: CHARACTER_ID,
    createdAt: nowLocalIso(),
    birthdayHistory: [],
    firstLaunchCompleted: false,
  };
  await saveCharacterState(created);
  return created;
}

/** 旧 active-character.json(selectedAt を持つ)を CharacterState(createdAt)へ写す。他フィールドは保つ。 */
function migrateLegacyState(legacy: Record<string, unknown>): CharacterState {
  const { selectedAt, ...rest } = legacy as { selectedAt?: unknown } & Record<string, unknown>;
  return {
    ...(rest as unknown as CharacterState),
    createdAt: typeof selectedAt === 'string' ? selectedAt : nowLocalIso(),
  };
}

export async function saveCharacterState(active: CharacterState): Promise<void> {
  await writeJson(getCharacterStatePath(), active);
}

/** 初回起動の操作案内を表示し終えたら呼ぶ(冪等)。 */
export async function markFirstLaunchCompleted(): Promise<void> {
  const active = await loadOrCreateCharacterState();
  if (!active.firstLaunchCompleted) {
    active.firstLaunchCompleted = true;
    await saveCharacterState(active);
  }
}

/**
 * 会話の“事実”を記録する(task_16・開示ゲーティングの素)。user ターンごとに呼ぶ。
 * 感情/好感度ではなく接触の事実(初回時刻・会話実日数・累計ターン)のみ(§5.3)。
 */
export async function recordConversationTurn(): Promise<void> {
  const active = await loadOrCreateCharacterState();
  const now = nowLocalIso();
  const today = now.slice(0, 10); // ローカル YYYY-MM-DD
  const rel = active.relationship ?? {
    firstMetAt: now,
    lastConversationDate: '',
    distinctConversationDays: 0,
    totalTurns: 0,
  };
  if (rel.lastConversationDate !== today) {
    rel.distinctConversationDays += 1;
    rel.lastConversationDate = today;
  }
  rel.totalTurns += 1;
  active.relationship = rel;
  await saveCharacterState(active);
}

/** ユーザーが誕生日に触れた時に呼ぶ(該当年を celebrated にする)。 */
export async function recordBirthdayCelebrated(year: number): Promise<void> {
  const active = await loadOrCreateCharacterState();
  const entry = active.birthdayHistory.find((h) => h.year === year);
  if (entry) {
    entry.celebrated = true;
    entry.celebratedAt = nowLocalIso();
  } else {
    active.birthdayHistory.push({ year, celebrated: true, celebratedAt: nowLocalIso() });
  }
  await saveCharacterState(active);
}

/**
 * キャラが相手(ユーザー)の誕生日を祝った事実を記録する(P5・キャラ誕生日 recordBirthdayCelebrated の鏡像)。
 * 当年を celebrated にして、誕生日当日に毎ターン祝い直す事態を防ぐ。
 */
export async function recordUserBirthdayCelebrated(year: number): Promise<void> {
  const active = await loadOrCreateCharacterState();
  const history = active.userBirthdayHistory ?? [];
  const entry = history.find((h) => h.year === year);
  if (entry) {
    entry.celebrated = true;
    entry.celebratedAt = nowLocalIso();
  } else {
    history.push({ year, celebrated: true, celebratedAt: nowLocalIso() });
  }
  active.userBirthdayHistory = history;
  await saveCharacterState(active);
}

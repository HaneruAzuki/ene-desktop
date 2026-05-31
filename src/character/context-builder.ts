import { setActiveCharacterId } from '../storage/paths';
import { todayLocalYmd } from '../shared/datetime';
import { loadCharacterProfile } from './loader';
import { loadOrCreateActiveCharacter } from './active-character';
import { buildSystemPrompt } from './system-prompt-builder';
import { checkBirthday } from './birthday-checker';
import type { CharacterContext } from '../shared/types/character';

// CharacterContext の組み立て(設計書 §3.1)。
// active キャラの取得 → プロファイル読込 → システムプロンプト構築 → 誕生日判定 を統合する。

export async function buildCharacterContext(): Promise<CharacterContext> {
  const active = await loadOrCreateActiveCharacter();

  // 記憶系パス(paths.ts)が同じ active キャラを指すようキャッシュを同期する。
  setActiveCharacterId(active.characterId);

  const profile = await loadCharacterProfile(active.characterId);

  const systemPrompt = buildSystemPrompt(
    profile.identity,
    profile.background,
    profile.knowledgeDomains,
  );

  const birthdayHint = checkBirthday(profile.identity, active, todayLocalYmd());

  return {
    identity: profile.identity,
    background: profile.background,
    knowledgeDomains: profile.knowledgeDomains,
    fewshot: profile.fewshot,
    portraitPath: profile.portraitPath,
    systemPrompt,
    birthdayHint,
  };
}

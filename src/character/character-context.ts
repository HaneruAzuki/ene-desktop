import { setActiveCharacterId } from '../shared/node/paths';
import { loadCharacterProfile } from './loader';
import { loadOrCreateActiveCharacter } from './active-character';
import { buildSystemPrompt } from './system-prompt-builder';
import type { CharacterContext } from '../shared/types/character';

// CharacterContext の組み立て(設計書 §3.1)。
// active キャラの取得 → プロファイル読込 → システムプロンプト構築 を統合する。
// 誕生日判定(birthdayHint)は「今日」に依存する起動時のモーメントなので、ここでは持たず
// 起動フロー(app/main/lifecycle)が checkBirthday(conversation/)で設定する(重複計算の解消・N-ARCH-6)。

export async function buildCharacterContext(): Promise<CharacterContext> {
  const active = await loadOrCreateActiveCharacter();

  // 記憶系パス(paths.ts)が同じ active キャラを指すようキャッシュを同期する。
  setActiveCharacterId(active.characterId);

  const profile = await loadCharacterProfile(active.characterId);

  const systemPrompt = buildSystemPrompt(
    profile.identity,
    profile.background,
    profile.knowledgeDomains,
    profile.currentState,
  );

  return {
    identity: profile.identity,
    background: profile.background,
    knowledgeDomains: profile.knowledgeDomains,
    fewshot: profile.fewshot,
    systemPrompt,
    currentState: profile.currentState,
  };
}

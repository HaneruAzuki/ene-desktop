import { join } from 'node:path';
import { getCharacterDir, getCurrentStatePath } from '../shared/node/paths';
import { readJson } from '../shared/node/json-store';
import type {
  CharacterIdentity,
  CharacterBackground,
  CharacterKnowledgeDomains,
  CharacterFewshot,
  CurrentState,
} from '../shared/types/character';

// キャラクタープロファイル(4ファイル)のロード(設計書 §3.1)。
// キャラ定義の不整合は致命的なので、欠損・characterId 不一致は例外を投げる
// (自動回復しない・task_02 の禁止事項)。

export interface LoadedCharacterProfile {
  identity: CharacterIdentity;
  background: CharacterBackground;
  knowledgeDomains: CharacterKnowledgeDomains;
  fewshot: CharacterFewshot;
  portraitPath: string; // 絶対パス(存在チェックはしない)
  currentState: CurrentState | null; // task_16・任意(不在可)
}

interface HasCharacterId {
  characterId: string;
}

export async function loadCharacterProfile(
  characterId: string,
): Promise<LoadedCharacterProfile> {
  const dir = getCharacterDir(characterId);

  const [identity, background, knowledgeDomains, fewshot] = await Promise.all([
    readJson<CharacterIdentity>(join(dir, 'identity.json')),
    readJson<CharacterBackground>(join(dir, 'background.json')),
    readJson<CharacterKnowledgeDomains>(join(dir, 'knowledge_domains.json')),
    readJson<CharacterFewshot>(join(dir, 'fewshot.json')),
  ]);

  // いずれかが欠けていたら致命的エラー
  const missing: string[] = [];
  if (!identity) missing.push('identity.json');
  if (!background) missing.push('background.json');
  if (!knowledgeDomains) missing.push('knowledge_domains.json');
  if (!fewshot) missing.push('fewshot.json');
  if (missing.length > 0 || !identity || !background || !knowledgeDomains || !fewshot) {
    throw new Error(
      `キャラクター定義が不完全です(${characterId}): ${missing.join(', ')} が見つかりません`,
    );
  }

  // characterId フィールドが引数と一致すること
  const files: Array<[string, HasCharacterId]> = [
    ['identity.json', identity],
    ['background.json', background],
    ['knowledge_domains.json', knowledgeDomains],
    ['fewshot.json', fewshot],
  ];
  for (const [fileName, obj] of files) {
    if (obj.characterId !== characterId) {
      throw new Error(
        `characterId 不一致(${fileName}): 期待 "${characterId}" / 実際 "${obj.characterId}"`,
      );
    }
  }

  // 現在状態(task_16)は任意。不在でも background のみで動く(後方互換・致命的でない)。
  const currentState = await readJson<CurrentState>(getCurrentStatePath(characterId));

  return {
    identity,
    background,
    knowledgeDomains,
    fewshot,
    portraitPath: join(dir, 'portrait.png'),
    currentState: currentState ?? null,
  };
}

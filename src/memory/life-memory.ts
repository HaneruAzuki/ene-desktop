import { getLifeMemoryPath, getActiveCharacterId } from '../storage/paths';
import { readJson } from '../storage/json-store';
import { migrateEpisodic } from './episodic';
import type { EpisodicMemory, EpisodicRecord } from '../shared/types/memory';

// 人生記憶 canon の読み込み(task_16・design-revision-character-heart §2)。
//
// canon = 作家が書いたキャラ自身の人生(provenance:'self')。キャラ資産として
// characters/{id}/life-memory.json に同梱され、**読み取り専用・忘却外・supersede 外**。
// 想起プールには user episodic と統合して入るが、保存・更新・mood 導出の対象にはしない。

/** canon 記録の ID。data/ の相対パスと衝突しないよう "self/" 名前空間にする。 */
function canonId(index: number): string {
  return `self/${index}`;
}

/**
 * canon を EpisodicRecord[] として読み込む。
 * 不在(人生記憶を持たないキャラ)は空配列を返す(後方互換・§7)。
 * provenance は 'self' を強制(ファイル側の指定を信頼しつつ、欠落でも self に倒す)。
 */
export async function loadLifeMemory(
  characterId: string = getActiveCharacterId(),
): Promise<EpisodicRecord[]> {
  const raw = await readJson<EpisodicMemory[]>(getLifeMemoryPath(characterId));
  if (!raw || !Array.isArray(raw)) return [];

  return raw.map((mem, i) => ({
    id: canonId(i),
    // 既定補完したうえで provenance:'self' を保証(canon は必ず self 扱い)。
    memory: { ...migrateEpisodic(mem), provenance: 'self' as const },
  }));
}

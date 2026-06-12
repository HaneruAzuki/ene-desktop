import { getSemanticPath } from '../storage/paths';
import { readJson, writeJson } from '../storage/json-store';
import { validateSemantic } from './schema-validation';
import type { SemanticMemory } from '../shared/types/memory';

// 長期記憶(Semantic・設計書 §3.3)。性格・好み・価値観など変化の少ない情報。
// 単一ファイル data/memory/{characterId}/semantic.json に平文保存。

export async function getSemantic(): Promise<SemanticMemory> {
  const raw = await readJson<unknown>(getSemanticPath());
  if (raw == null) {
    return { version: 1 };
  }
  return validateSemantic(raw);
}

// updateSemantic からのみ呼ぶ内部関数(外部公開しない・保存前検証を一元化するため)。
async function saveSemantic(memory: SemanticMemory): Promise<void> {
  // 保存前に必ずスキーマ検証(CLAUDE §7.3)。
  await writeJson(getSemanticPath(), validateSemantic(memory));
}

/**
 * 既存の semantic.json に patch をマージして保存する。
 * extra フィールドは深くマージする(既存値を残してから上書き)。
 */
export async function updateSemantic(patch: Partial<SemanticMemory>): Promise<void> {
  const current = await getSemantic();
  const merged: SemanticMemory = {
    ...current,
    ...patch,
    version: patch.version ?? current.version,
  };
  // extra は深くマージ(コア以外で唯一の自由領域・既存キーを失わない)
  if (current.extra || patch.extra) {
    merged.extra = { ...(current.extra ?? {}), ...(patch.extra ?? {}) };
  }
  await saveSemantic(merged);
}

import { getSemanticPath } from '../shared/node/paths';
import { readJson, writeJson } from '../shared/node/json-store';
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
 * 主人の名前の硬いロック(主人固定・2026-06)。
 *
 * 主人(あるじ)=一生そばにいる決まった相手は一人。その名前(userName)は **一度確定したら会話/抽出では変えない**。
 * まだ覚えていない(currentUserName が空)ときだけ、patch.userName で初代主人を確定できる。
 * 既に確定済みなら patch から userName を取り除いて返す(名前以外=読み・好み・誕生日等は素通し)。
 *
 * これは LLM 判断に依存しないコード側の保証(抽出器が誤って別名を出しても主人名は守られる)。
 * 意図的な改名(将来の設定パネル/記憶ファイル直編集)は updateSemantic を直接呼ぶ経路に委ねる。
 * 純粋関数(I/O なし)=単体テスト対象。
 */
export function lockOwnerName(
  patch: Partial<SemanticMemory>,
  currentUserName: string | undefined,
): Partial<SemanticMemory> {
  if (!currentUserName || patch.userName === undefined) return patch;
  const rest = { ...patch };
  delete rest.userName; // 確定済みの主人名は会話/抽出では上書きしない
  return rest;
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

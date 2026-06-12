import type { SemanticMemory, ExtraValue } from '../shared/types/memory';

// SemanticMemory のスキーマ検証(設計書 §3.3「SemanticMemory のスキーマ検証方針」)。
// 手書きの型ガードで実装する(zod 等は使わない・task_03 禁止事項)。
//
// 方針:
// - コアフィールドは型が一致するものだけ採用し、型不一致のフィールドは無視する
//   (例外を投げない。壊れた semantic.json でも会話を継続させる・NF-REL-02)。
// - extra 領域は「ExtraValue のいずれか」である値だけ採用し、不正な値のキーは個別に捨てる
//   (全体は壊さない。LLM が追記した内容を尊重)。

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
  );
}

function isExtraValue(v: unknown): v is ExtraValue {
  return (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    isStringArray(v)
  );
}

function pickExtra(v: unknown): Record<string, ExtraValue> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const valid: Record<string, ExtraValue> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (isExtraValue(val)) valid[k] = val; // 不正値のキーは個別に無視
  }
  return Object.keys(valid).length > 0 ? valid : undefined;
}

/** 既知のコアフィールドのみを型チェックして抜き出す(version は付与しない)。 */
export function validateSemanticPatch(raw: unknown): Partial<SemanticMemory> {
  const result: Partial<SemanticMemory> = {};
  if (typeof raw !== 'object' || raw === null) return result;
  const o = raw as Record<string, unknown>;
  if (typeof o.userName === 'string') result.userName = o.userName;
  if (isStringRecord(o.preferences)) result.preferences = o.preferences;
  if (isStringArray(o.longTermGoals)) result.longTermGoals = o.longTermGoals;
  if (isStringArray(o.personality)) result.personality = o.personality;
  const extra = pickExtra(o.extra);
  if (extra) result.extra = extra;
  return result;
}

/** 完全な SemanticMemory に正規化する(version は必須・既定 1)。 */
export function validateSemantic(raw: unknown): SemanticMemory {
  const patch = validateSemanticPatch(raw);
  let version = 1;
  if (typeof raw === 'object' && raw !== null) {
    const v = (raw as Record<string, unknown>).version;
    if (typeof v === 'number') version = v;
  }
  return { version, ...patch };
}

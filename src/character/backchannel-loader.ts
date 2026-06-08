import { getBackchannelPoolPath } from '../storage/paths';
import { readJson } from '../storage/json-store';
import { log } from '../shared/logger';
import type { BackchannelCue, BackchannelPoolData } from '../shared/types/backchannel';

// 相槌の語彙(backchannels.json)のロード(task_18 Phase B)。
// キャラ依存の語彙は characters/{id}/backchannels.json に外出し(§4.5)。
// 無い・不正なら null(呼び出し側は相槌なしへフォールバック=会話は成立)。

const CUES: BackchannelCue[] = ['continuer', 'understanding', 'surprise', 'empathy'];

/** 文字列配列から空でない文字列のみを取り出す。 */
function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((w): w is string => typeof w === 'string' && w.length > 0);
}

/** backchannels.json を検証して正規化する。continuer が空なら null(フォールバック先が無い)。 */
export function validateBackchannelPool(raw: unknown): BackchannelPoolData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'number') return null;
  if (typeof o.cues !== 'object' || o.cues === null) return null;

  const cuesRaw = o.cues as Record<string, unknown>;
  const cues: Partial<Record<BackchannelCue, string[]>> = {};
  for (const cue of CUES) {
    const words = stringList(cuesRaw[cue]);
    if (words.length > 0) cues[cue] = words;
  }
  if (!cues.continuer) return null; // continuer は必須(フォールバック先)

  const pool: BackchannelPoolData = { version: o.version, cues };
  const tf = stringList(o.thinkingFiller);
  if (tf.length > 0) pool.thinkingFiller = tf;
  return pool;
}

/** backchannels.json を読み込む。無ければ/不正なら null。 */
export async function loadBackchannelPool(characterId: string): Promise<BackchannelPoolData | null> {
  const raw = await readJson<unknown>(getBackchannelPoolPath(characterId));
  if (raw === null) return null;
  const validated = validateBackchannelPool(raw);
  if (!validated) {
    log.warn(`backchannels.json invalid for ${characterId}; backchannel disabled`);
    return null;
  }
  return validated;
}

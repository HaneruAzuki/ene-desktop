import { promises as fs } from 'node:fs';
import { getAnimationPath, getCharacterAssetPath } from '../shared/node/paths';
import { readJson } from '../shared/node/json-store';
import { log } from '../shared/logger';
import type {
  CharacterAnimation,
  CharacterAnimationData,
} from '../shared/types/animation';

// アニメ定義のロード(task_13・F-ANIM-02/11)。
// animation.json が無い・不正な場合は null を返し、呼び出し側は単一 portrait 表示へフォールバックする。

/** raw を検証して CharacterAnimation に正規化する。不正なら null(後方互換フォールバック)。 */
export function validateAnimation(raw: unknown): CharacterAnimation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;

  const frameSize = a.frameSize as { width?: unknown; height?: unknown } | undefined;
  if (!frameSize || typeof frameSize.width !== 'number' || typeof frameSize.height !== 'number') {
    return null;
  }

  // frames: 文字列値のみ採用(未知/不正値は無視)。
  const frames: Record<string, string> = {};
  if (typeof a.frames === 'object' && a.frames !== null) {
    for (const [k, v] of Object.entries(a.frames as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) frames[k] = v;
    }
  }
  if (Object.keys(frames).length === 0) return null;

  const map = a.map as Record<string, unknown> | undefined;
  if (!map || typeof map.base !== 'object' || map.base === null) return null;

  return {
    characterId: typeof a.characterId === 'string' ? a.characterId : '',
    frameSize: { width: frameSize.width, height: frameSize.height },
    frames,
    // base の存在は上で検証済み。詳細な形は表示側のフォールバックで吸収するため unknown 経由で通す。
    map: map as unknown as CharacterAnimation['map'],
    timing: (a.timing as CharacterAnimation['timing']) ?? undefined,
  };
}

/** animation.json を読み込む。無ければ null(F-ANIM-11)。 */
export async function loadCharacterAnimation(
  characterId: string,
): Promise<CharacterAnimation | null> {
  const raw = await readJson<unknown>(getAnimationPath(characterId));
  if (raw === null) return null;
  const validated = validateAnimation(raw);
  if (!validated) {
    log.warn(`animation.json invalid for ${characterId}; falling back to portrait`);
    return null;
  }
  return validated;
}

/** 1ファイルを base64 dataURL 化(CSP/sandbox のため Renderer には dataURL で渡す・N-08-1)。 */
async function fileToDataUrl(absPath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(absPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Renderer 配布用のアニメデータ(frames を dataURL 化)を組み立てる。
 * 読めないフレームは除外する。有効フレームが無ければ null(=portrait フォールバック)。
 */
export async function loadAnimationData(
  characterId: string,
): Promise<CharacterAnimationData | null> {
  const anim = await loadCharacterAnimation(characterId);
  if (!anim) return null;

  const frames: Record<string, string> = {};
  for (const [name, file] of Object.entries(anim.frames)) {
    const url = await fileToDataUrl(getCharacterAssetPath(characterId, file));
    if (url) frames[name] = url;
  }
  if (Object.keys(frames).length === 0) return null;

  return { frameSize: anim.frameSize, frames, map: anim.map, timing: anim.timing };
}

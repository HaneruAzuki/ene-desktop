import { promises as fs } from 'node:fs';
import { getVrmConfigPath, getCharacterAssetPath } from '../shared/node/paths';
import { readJson } from '../shared/node/json-store';
import { log } from '../shared/logger';
import {
  DEFAULT_VRM_DISPLAY,
  type VrmConfig,
  type VrmDisplayParams,
  type VrmExpressionMap,
  type VrmRenderConfig,
} from '../shared/types/vrm';

// VRM 表示設定のロード(F・3D化)。
// vrm.json が無い/不正・モデルファイルが読めない場合は null を返し、
// 呼び出し側は既存の PNG 立ち絵経路へフォールバックする(§3.7・後方互換)。

/** 数値フィールドを既定値で補完しつつ正規化する(不正値=既定)。 */
function normalizeDisplay(raw: unknown): VrmDisplayParams {
  const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    height: num(d.height, DEFAULT_VRM_DISPLAY.height),
    distance: num(d.distance, DEFAULT_VRM_DISPLAY.distance),
    yawDeg: num(d.yawDeg, DEFAULT_VRM_DISPLAY.yawDeg),
    armDownDeg: num(d.armDownDeg, DEFAULT_VRM_DISPLAY.armDownDeg),
  };
}

/** raw を検証して VrmConfig に正規化する。model 名が無ければ null(=フォールバック)。 */
export function validateVrmConfig(raw: unknown): VrmConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.model !== 'string' || a.model.length === 0) return null;

  // expressionMap: 文字列値のみ採用(未知/不正値は無視)。
  const expressionMap: VrmExpressionMap = {};
  if (typeof a.expressionMap === 'object' && a.expressionMap !== null) {
    for (const [k, v] of Object.entries(a.expressionMap as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) expressionMap[k as keyof VrmExpressionMap] = v;
    }
  }

  return {
    characterId: typeof a.characterId === 'string' ? a.characterId : '',
    model: a.model,
    expressionMap,
    display: normalizeDisplay(a.display),
  };
}

// vrm.json は配布物の静的アセット(実行中に変わらない)。get-vrm-config と get-character-model の
// 二重読みを避けるため characterId 単位でメモ化する(柱4・軽量原則)。
const vrmConfigCache = new Map<string, VrmConfig | null>();

/** vrm.json を読み込む(メモ化)。無ければ/不正なら null(フォールバック)。 */
export async function loadVrmConfig(characterId: string): Promise<VrmConfig | null> {
  const cached = vrmConfigCache.get(characterId);
  if (cached !== undefined) return cached;
  const raw = await readJson<unknown>(getVrmConfigPath(characterId));
  const validated = raw === null ? null : validateVrmConfig(raw);
  if (raw !== null && !validated) {
    log.warn(`vrm.json invalid for ${characterId}; falling back to portrait`);
  }
  vrmConfigCache.set(characterId, validated);
  return validated;
}

/**
 * VRM モデル本体(.vrm)のバイト列を読む。10MB 規模を base64 化せず、IPC で ArrayBuffer を渡す(§3.8)。
 * 読めなければ null(=PNG フォールバック)。
 */
export async function loadVrmModelBytes(characterId: string, modelFile: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await fs.readFile(getCharacterAssetPath(characterId, modelFile));
    // Buffer の backing ArrayBuffer の該当範囲だけを切り出して返す(プール共有を避ける)。
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
}

/** display にユーザー上書き(app-settings)をマージした実効値を作る。 */
export function mergeDisplay(
  base: VrmDisplayParams,
  override: Partial<VrmDisplayParams> | undefined,
): VrmDisplayParams {
  if (!override) return base;
  return {
    height: override.height ?? base.height,
    distance: override.distance ?? base.distance,
    yawDeg: override.yawDeg ?? base.yawDeg,
    armDownDeg: override.armDownDeg ?? base.armDownDeg,
  };
}

/** Renderer 配布用の設定(モデルバイトは含めない・display はユーザー上書きマージ済み)。 */
export function buildVrmRenderConfig(
  config: VrmConfig,
  displayOverride: Partial<VrmDisplayParams> | undefined,
): VrmRenderConfig {
  return {
    expressionMap: config.expressionMap,
    display: mergeDisplay(config.display, displayOverride),
  };
}

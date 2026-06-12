import { getVoiceConfigPath } from '../storage/paths';
import { readJson } from '../storage/json-store';
import { log } from '../shared/logger';
import type { EmotionLabel } from '../shared/types/animation';
import type { TtsOptions, VoiceConfig, VoiceStyleParams } from '../shared/types/voice';

// 音声設定(voice.json)のロード(task_17 / design-revision-voice §4.2)。
// emotion→スタイル/パラメータは characters/{id}/voice.json に外出し(§4.5・ハードコード禁止)。
// 無い・不正なら null(呼び出し側は TTS 無効=テキストのみへフォールバック)。

const NUMERIC_KEYS = ['speedScale', 'intonationScale', 'tempoDynamicsScale', 'volumeScale'] as const;

// baseUrl は後段の TTS クライアントが HTTP リクエスト先に使う(ローカル AivisSpeech サイドカー)。
// 検証なしだと file:/javascript:/smb: 等のスキームや不正文字列が通り SSRF 面になる(公開前監査の指摘)。
// http/https かつホスト名を持つ整形式 URL のみ許可する(localhost / 127.0.0.1 は当然通す)。
const ALLOWED_BASE_URL_PROTOCOLS = ['http:', 'https:'] as const;

/** baseUrl が http/https かつホスト名を持つ整形式 URL なら true。それ以外(他スキーム・不正)は false。 */
function isValidBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // new URL() が投げる = 整形式でない(相対 URL や空文字含む)。
    return false;
  }
  if (!ALLOWED_BASE_URL_PROTOCOLS.includes(url.protocol as (typeof ALLOWED_BASE_URL_PROTOCOLS)[number])) {
    return false;
  }
  // ホスト名が無い URL(例:file:///path は hostname が空)を弾く。
  return url.hostname.length > 0;
}

/** 1スタイルを検証(styleId 必須・他の数値パラメータは任意)。不正なら null。 */
function validateStyle(raw: unknown): VoiceStyleParams | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.styleId !== 'number') return null;
  const style: VoiceStyleParams = { styleId: o.styleId };
  for (const k of NUMERIC_KEYS) {
    const v = o[k];
    if (typeof v === 'number') style[k] = v;
  }
  return style;
}

/** voice.json を検証して VoiceConfig に正規化する。不正なら null。 */
export function validateVoiceConfig(raw: unknown): VoiceConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.engine !== 'string' || typeof o.baseUrl !== 'string') return null;
  // baseUrl は http/https の整形式 URL のみ許可(他スキーム・不正は拒否=他の不正フィールドと同様 null へ)。
  if (!isValidBaseUrl(o.baseUrl)) return null;
  if (typeof o.styles !== 'object' || o.styles === null) return null;

  const styles: Partial<Record<EmotionLabel, VoiceStyleParams>> = {};
  for (const [k, v] of Object.entries(o.styles as Record<string, unknown>)) {
    const style = validateStyle(v);
    if (style) styles[k as EmotionLabel] = style;
  }
  // neutral はフォールバック先として必須。
  if (!styles.neutral) return null;

  return {
    engine: o.engine,
    baseUrl: o.baseUrl,
    model: typeof o.model === 'string' ? o.model : undefined,
    credit: typeof o.credit === 'string' ? o.credit : undefined,
    styles,
  };
}

/** voice.json を読み込む。無ければ/不正なら null。 */
export async function loadVoiceConfig(characterId: string): Promise<VoiceConfig | null> {
  const raw = await readJson<unknown>(getVoiceConfigPath(characterId));
  if (raw === null) return null;
  const validated = validateVoiceConfig(raw);
  if (!validated) {
    log.warn(`voice.json invalid for ${characterId}; TTS disabled`);
    return null;
  }
  return validated;
}

/** emotion に対応するスタイル/パラメータを解決する(欠落は neutral へフォールバック・F-ANIM-06 同方針)。 */
export function resolveStyle(config: VoiceConfig, emotion: EmotionLabel): TtsOptions {
  return config.styles[emotion] ?? config.styles.neutral ?? { styleId: 0 };
}

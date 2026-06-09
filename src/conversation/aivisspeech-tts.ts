import type { TtsEngine, TtsOptions, TtsStyle } from '../shared/types/voice';

// AivisSpeech(VOICEVOX互換ローカルAPI)への TtsEngine 実装(task_17 / design-revision-voice §4.1)。
// localhost のサイドカーへ HTTP で問い合わせる(端末内=外部通信ではない・§4.2維持)。
// fetch は DI 可能(テスト容易化)。pitchScale は使わない(AivisSpeech で音質劣化)。

/** 使用する fetch 応答の最小形(DOM/undici のグローバル型に依存しない)。 */
interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

// 実行時(Node/Electron main)はグローバル fetch を使う。型は lib 非依存のため構造でキャストする。
const defaultFetch: FetchLike = (url, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);

/** audio_query の結果に合成パラメータを反映する(pitchScale は触らない)。純粋関数。 */
export function applyVoiceParams(
  query: Record<string, unknown>,
  opts: TtsOptions,
): Record<string, unknown> {
  if (typeof opts.speedScale === 'number') query.speedScale = opts.speedScale;
  if (typeof opts.intonationScale === 'number') query.intonationScale = opts.intonationScale;
  if (typeof opts.tempoDynamicsScale === 'number') query.tempoDynamicsScale = opts.tempoDynamicsScale;
  if (typeof opts.volumeScale === 'number') query.volumeScale = opts.volumeScale;
  return query;
}

/**
 * アクセント(下げ位置)の上書きを **最後の accent_phrase** に反映する(相槌/フィラーの語ごと調律)。
 * 例「そうね」は既定 accent=3(平板=フラット)だが accent=1 で頭高(下降)になり自然になる。純粋関数。
 */
export function applyAccent(query: Record<string, unknown>, accent?: number): Record<string, unknown> {
  if (typeof accent !== 'number') return query;
  const phrases = query.accent_phrases;
  if (Array.isArray(phrases) && phrases.length > 0) {
    const ap = phrases[phrases.length - 1] as { accent?: number; moras?: unknown[] } | undefined;
    if (ap && typeof ap === 'object') {
      const n = Array.isArray(ap.moras) ? ap.moras.length : accent;
      ap.accent = Math.max(1, Math.min(accent, n));
    }
  }
  return query;
}

/** /speakers の応答を TtsStyle[] に変換する(話者×スタイル)。純粋関数。 */
export function parseSpeakers(data: unknown): TtsStyle[] {
  if (!Array.isArray(data)) return [];
  const out: TtsStyle[] = [];
  for (const sp of data) {
    if (typeof sp !== 'object' || sp === null) continue;
    const speaker = sp as { name?: unknown; styles?: unknown };
    const speakerName = typeof speaker.name === 'string' ? speaker.name : '';
    if (!Array.isArray(speaker.styles)) continue;
    for (const st of speaker.styles) {
      if (typeof st !== 'object' || st === null) continue;
      const style = st as { name?: unknown; id?: unknown };
      if (typeof style.id !== 'number') continue;
      const styleName = typeof style.name === 'string' ? style.name : '';
      out.push({ name: speakerName ? `${speakerName}/${styleName}` : styleName, styleId: style.id });
    }
  }
  return out;
}

export class AivisSpeechTtsEngine implements TtsEngine {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(baseUrl: string, fetchFn: FetchLike = defaultFetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // 末尾スラッシュ除去
    this.fetchFn = fetchFn;
  }

  async speak(text: string, opts: TtsOptions): Promise<ArrayBuffer> {
    const query = await this.audioQuery(text, opts.styleId);
    applyVoiceParams(query, opts);
    applyAccent(query, opts.accent); // 語ごとのアクセント上書き(相槌/フィラー調律)
    const res = await this.fetchFn(`${this.baseUrl}/synthesis?speaker=${opts.styleId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
      body: JSON.stringify(query),
    });
    if (!res.ok) throw new Error(`synthesis failed: ${res.status}`);
    return res.arrayBuffer();
  }

  async listStyles(): Promise<TtsStyle[]> {
    const res = await this.fetchFn(`${this.baseUrl}/speakers`, { method: 'GET' });
    if (!res.ok) throw new Error(`speakers failed: ${res.status}`);
    return parseSpeakers(await res.json());
  }

  private async audioQuery(text: string, styleId: number): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/audio_query?speaker=${styleId}&text=${encodeURIComponent(text)}`;
    const res = await this.fetchFn(url, { method: 'POST' });
    if (!res.ok) throw new Error(`audio_query failed: ${res.status}`);
    const json = await res.json();
    return (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  }
}

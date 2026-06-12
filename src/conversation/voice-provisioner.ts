import { type EmotionLabel } from '../shared/types/animation';
import type { TtsStyle, VoiceConfig, VoiceStyleParams } from '../shared/types/voice';

// 音声の自動プロビジョニング(task_17 / design-revision-voice §4.3)。
//
// 同梱 voice.json の固定パラメータを保ちつつ、起動後 `/speakers` で得た実 styleId を
// マージする(reconcileVoiceConfig)。純粋ロジック=単体テスト対象。

// /speakers のスタイル名から emotion ラベルへの最良一致(モデル依存・取り切れない分は neutral)。
const STYLE_HINTS: Record<EmotionLabel, string[]> = {
  neutral: ['ノーマル', '通常', 'normal', 'neutral'],
  joy: ['喜', '嬉', 'うれ', 'たのし', 'joy', 'happy'],
  anger: ['怒', 'ツン', 'いか', 'anger', 'angry'],
  sorrow: ['悲', '哀', 'かなし', 'sad', 'sorrow'],
  surprise: ['驚', 'びっくり', 'surprise'],
  embarrassed: ['照', 'デレ', 'てれ', 'embarrass', 'shy'],
};

/**
 * 同梱 voice.json(固定パラメータ＋暫定 styleId)に、起動後 `/speakers` で得た**実 styleId** をマージする。
 *
 * speedScale/intonationScale 等の固定パラメータは**同梱の値を保持し、styleId だけ実値へ差し替える**
 * (HANDOFF 注意1・注意2:styleId はグローバルで起動時確定)。
 */
export function reconcileVoiceConfig(bundled: VoiceConfig, styles: TtsStyle[]): VoiceConfig {
  const resolveId = (emotion: EmotionLabel, fallback: number): number => {
    const match = styles.find((s) => STYLE_HINTS[emotion].some((h) => s.name.includes(h)));
    return match?.styleId ?? fallback;
  };
  // neutral の解決を全 emotion のフォールバックに使う(単一スタイルモデルでは全部これになる)。
  const neutralId = resolveId('neutral', styles[0]?.styleId ?? bundled.styles.neutral?.styleId ?? 0);

  const out: Partial<Record<EmotionLabel, VoiceStyleParams>> = {};
  for (const key of Object.keys(bundled.styles) as EmotionLabel[]) {
    const params = bundled.styles[key];
    if (!params) continue;
    out[key] = { ...params, styleId: resolveId(key, neutralId) };
  }
  return { ...bundled, styles: out };
}

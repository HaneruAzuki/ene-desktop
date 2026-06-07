import { EMOTION_LABELS, type EmotionLabel } from '../shared/types/animation';
import type { TtsStyle, VoiceConfig, VoiceStyleParams } from '../shared/types/voice';

// 音声の自動プロビジョニング(task_17 / design-revision-voice §4.3)。
//
// 配布時にユーザーへ手動セットアップを求めないため、アプリが
//   ①エンジン取得 → ②声モデル配置 → ③起動 → ヘルス確認 → /speakers → voice.json 生成
// を自動化する。副作用(DL/spawn/HTTP/FS)は ProvisionEnv に注入し、本体は純粋な進行ロジック
// =単体テスト対象。実際の DL/起動は main 側の薄いアダプタが担う(§4.2例外=エンジン/モデル取得のみ承認済)。

export type ProvisionStep = 'engine' | 'model' | 'start' | 'health' | 'styles';

/** プロビジョニングが依存する副作用(main 側で実装を注入)。 */
export interface ProvisionEnv {
  enginePresent(): Promise<boolean>;
  modelPresent(): Promise<boolean>;
  downloadEngine(): Promise<void>; // run.exe 一式を data/voice/engine/ へ
  downloadModel(): Promise<void>; // つくよみ AIVMX を Models ディレクトリへ
  startEngine(): Promise<void>; // run.exe --host 127.0.0.1 --port 10101(shell:false)
  waitHealthy(): Promise<boolean>; // /version 等をポーリング
  fetchStyles(): Promise<TtsStyle[]>; // /speakers
  writeVoiceConfig(styles: TtsStyle[]): Promise<void>; // characters/{id}/voice.json 生成
}

export interface ProvisionResult {
  ok: boolean;
  failedAt?: ProvisionStep;
}

/** 進行通知(任意・初回セットアップ UI 用)。 */
export type ProvisionProgress = (step: ProvisionStep, phase: 'start' | 'done') => void;

/**
 * 音声環境を自動セットアップする。既に在るものは飛ばす(冪等)。
 * 失敗したらどのステップで止まったかを返す(UI でキャラ口調のフォールバック表示・§8.3)。
 */
export async function provisionVoice(
  env: ProvisionEnv,
  onProgress: ProvisionProgress = () => {},
): Promise<ProvisionResult> {
  let step: ProvisionStep = 'engine';
  try {
    if (!(await env.enginePresent())) {
      onProgress('engine', 'start');
      await env.downloadEngine();
      onProgress('engine', 'done');
    }
    step = 'model';
    if (!(await env.modelPresent())) {
      onProgress('model', 'start');
      await env.downloadModel();
      onProgress('model', 'done');
    }
    step = 'start';
    onProgress('start', 'start');
    await env.startEngine();
    onProgress('start', 'done');

    step = 'health';
    onProgress('health', 'start');
    if (!(await env.waitHealthy())) return { ok: false, failedAt: 'health' };
    onProgress('health', 'done');

    step = 'styles';
    onProgress('styles', 'start');
    const styles = await env.fetchStyles();
    await env.writeVoiceConfig(styles);
    onProgress('styles', 'done');

    return { ok: true };
  } catch {
    return { ok: false, failedAt: step };
  }
}

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
 * /speakers の結果から voice.json(VoiceConfig)を組み立てる。
 * スタイル名のヒントで emotion へ寄せ、neutral は必ず埋める(フォールバック先)。
 * 最終的な styleId 割り当ては手動で調整可(設定の外出し・§4.5)。
 */
export function buildVoiceConfig(styles: TtsStyle[], baseUrl: string, model?: string): VoiceConfig {
  const byEmotion: Partial<Record<EmotionLabel, { styleId: number }>> = {};
  for (const emotion of EMOTION_LABELS) {
    const match = styles.find((s) => STYLE_HINTS[emotion].some((h) => s.name.includes(h)));
    if (match) byEmotion[emotion] = { styleId: match.styleId };
  }
  if (!byEmotion.neutral) {
    byEmotion.neutral = { styleId: styles[0]?.styleId ?? 0 };
  }
  return { engine: 'aivisspeech', baseUrl, model, styles: byEmotion };
}

/**
 * 同梱 voice.json(固定パラメータ＋暫定 styleId)に、起動後 `/speakers` で得た**実 styleId** をマージする。
 *
 * `buildVoiceConfig` は emotion ごとに `{styleId}` しか書かず、同梱 voice.json の
 * speedScale/intonationScale 等の固定パラメータを失う(HANDOFF 注意1)。
 * → **パラメータ値は同梱を保持し、styleId だけ実値へ差し替える**(注意2:styleId はグローバルで起動時確定)。
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

import { log } from '../shared/logger';
import { BACKCHANNEL_SPEED_SCALE } from '../shared/constants';
import { BackchannelEngine } from '../conversation/backchannel-engine';
import { selectBackchannel } from '../conversation/backchannel-pool';
import { loadBackchannelPool } from '../character/backchannel-loader';
import { resolveStyle } from '../character/voice-loader';
import {
  loadBackchannelCalibration,
  saveBackchannelCalibration,
} from '../storage/backchannel-calibration';
import type { BackchannelPoolData } from '../shared/types/backchannel';
import type { TtsEngine, VoiceConfig } from '../shared/types/voice';

/** 学習値をディスクに保存するまでの相槌回数(間引き・Lv2b)。 */
const CALIBRATION_SAVE_EVERY = 5;

// 相槌コントローラ(main・task_18 Phase B)。
//
// VadRuntime のフレームループに相乗りし、BackchannelEngine が「相槌を打つ」と判断したら
// 事前合成済みの WAV を renderer へ送る。発話中の即時再生のため、相槌語は hands-free 開始時に
// **一度だけ事前合成(prewarm)** してキャッシュする(AivisSpeech は2-3モーラでも数百msかかるため)。
//
// best-effort: 音声無効(エンジン未起動/voice.json なし/backchannels.json なし)なら相槌なし=会話は成立。
// 設計の憲法(task_18): 尺・有無は「良い聞き手とは」で決める。Claude が返るまでの時間では決めない。

export interface BackchannelDeps {
  characterId: string;
  /** 実行時の TTS(起動順の都合で遅延参照する)。 */
  getTts: () => TtsEngine | null;
  getVoiceConfig: () => VoiceConfig | null;
  /** 相槌を送る。wav があれば音声再生、null なら**うなずきのみ**(音声未準備時)。 */
  send: (wav: ArrayBuffer | null) => void;
  /** 語選択の揺らぎ(0..1)。 */
  rng: () => number;
}

export class BackchannelController {
  private readonly engine = new BackchannelEngine();
  private pool: BackchannelPoolData | null = null;
  private synth: Map<string, ArrayBuffer> | null = null;
  private preparing: Promise<void> | null = null;
  private lastPhrase: string | undefined;
  private lastFiller: string | undefined; // 思考フィラーの反復回避
  /** 学習値(音響キャリブレーション)を一度だけ復元する(永続化・Lv2b)。 */
  private calibrated = false;
  /** 相槌の累計回数(学習値の間引き保存用)。 */
  private fireCount = 0;

  constructor(private readonly deps: BackchannelDeps) {}

  /**
   * hands-free 開始時に pool ロード＋相槌の事前合成を試みる(best-effort)。
   * **音声合成は成功するまで毎回リトライ**する(エンジンを後から起動しても拾えるように)。
   * pool さえ読めれば「うなずき(非言語)」は音声なしでも動く=エンジン不要。
   */
  async prepare(): Promise<void> {
    if (this.synth && this.synth.size > 0) return; // 音声まで準備済み=完了
    this.preparing ??= this.doPrepare().finally(() => {
      this.preparing = null;
    });
    return this.preparing;
  }

  private async doPrepare(): Promise<void> {
    try {
      this.pool ??= await loadBackchannelPool(this.deps.characterId);
      if (!this.pool) return; // backchannels.json なし → 相槌なし
      if (!this.calibrated) {
        // 前回までの学習値(声の平常・比の分布)を復元(継続利用で賢くする・Lv2b)。
        this.engine.loadCalibration(await loadBackchannelCalibration());
        this.calibrated = true; // null(初回)でも再試行しない=初期値で学習開始
      }
      const tts = this.deps.getTts();
      const voiceConfig = this.deps.getVoiceConfig();
      if (tts && voiceConfig) {
        const synth = await prewarm(this.pool, tts, voiceConfig);
        if (synth.size > 0) this.synth = synth; // 失敗(0件)なら次回また試す
      }
      log.info(`backchannel ready (timing on; audio: ${this.synth?.size ?? 0} phrases)`);
    } catch (e) {
      log.warn(`backchannel prepare failed: ${(e as Error).name}`);
    }
  }

  /** ターン境界・セッション開始/終了で状態を初期化。 */
  reset(): void {
    this.engine.reset();
  }

  /**
   * 1フレームの発話確率＋RMS を投入(ENE 非発話中=ユーザの番にのみ呼ぶこと)。
   * 相槌を打つべきなら送る。**タイミング(=うなずき)は pool だけで動く**(音声は任意・あれば一緒に鳴る)。
   * cue は韻律(Lv2)で continuer/surprise を出し分ける。
   */
  onFrame(prob: number, rms = 0, f0 = 0): void {
    if (!this.pool) return;
    const decision = this.engine.push(prob, rms, f0);
    if (!decision) return;
    const phrase = selectBackchannel(this.pool, decision.cue, this.deps.rng, this.lastPhrase);
    this.lastPhrase = phrase;
    const wav = this.synth?.get(phrase) ?? null; // 音声未準備なら null=うなずきのみ
    // §6.2: 本文は出さない。型と韻律の数値(調律用)のみ。
    log.info(
      `backchannel: cue=${decision.cue} ` +
        `pRatio=${decision.pitchRatio?.toFixed(2) ?? 'n/a'}/${decision.pitchThreshold?.toFixed(2) ?? 'n/a'} ` +
        `eRatio=${decision.energyRatio?.toFixed(2) ?? 'n/a'}/${decision.energyThreshold?.toFixed(2) ?? 'n/a'} ` +
        `pPeak=${decision.pitchPeak?.toFixed(0) ?? 'n/a'} pBase=${decision.pitchBaseline?.toFixed(0) ?? 'n/a'} ` +
        `ePeak=${decision.energyPeak?.toFixed(4) ?? 'n/a'} eBase=${decision.energyBaseline?.toFixed(4) ?? 'n/a'}`,
    );
    this.deps.send(wav);
    // 学習値を間引いて保存(継続利用で賢くする・Lv2b)。best-effort・非ブロッキング。
    this.fireCount += 1;
    if (this.fireCount % CALIBRATION_SAVE_EVERY === 0) void this.save();
  }

  /**
   * 思考フィラー(「うーん…」等)を1つ再生する(答える入り・熟考時・Phase C / B-15連動)。
   * 相槌と同じ `send`(=`ene:backchannel` 経路)で送るので、再生は backchannel-player、
   * 応答の第一声が来たら既存のダッキング(stopBackchannel)で自動停止する。
   * pool 未ロード/語なしなら何もしない。音声未準備(synth なし)なら null=うなずきのみ。best-effort。
   * **設計憲法**: 呼ぶか否かは呼び出し側(ipc)が「問いの性質」で決める(遅延では決めない)。
   */
  playThinkingFiller(): void {
    const fillers = this.pool?.thinkingFiller;
    if (!fillers || fillers.length === 0) {
      void this.prepare(); // pool 未ロード(テキスト入力で未準備等)なら準備を試みる=次回に間に合わせる
      return;
    }
    // 反復回避で1つ選ぶ(直前と同じは避ける)。
    const avail = fillers.length > 1 ? fillers.filter((w) => w !== this.lastFiller) : fillers;
    const list = avail.length > 0 ? avail : fillers;
    const phrase = list[Math.min(list.length - 1, Math.floor(this.deps.rng() * list.length))];
    if (!phrase) return;
    this.lastFiller = phrase;
    const wav = this.synth?.get(phrase) ?? null; // 音声未準備なら null=うなずきのみ
    if (!wav) void this.prepare(); // 音声がまだなら合成を試みる(次回に向けて)
    log.info('thinking filler played'); // §6.2: 本文は出さない
    this.deps.send(wav);
  }

  /** 学習値(音響キャリブレーション)をディスクへ保存する(best-effort・Lv2b)。 */
  async save(): Promise<void> {
    if (!this.calibrated) return; // 何も復元/学習していなければ書かない
    await saveBackchannelCalibration(this.engine.getCalibration());
  }
}

/** 相槌語を neutral スタイルで一度ずつ合成してキャッシュする(§6.2: 本文はログに出さない)。 */
async function prewarm(
  pool: BackchannelPoolData,
  tts: TtsEngine,
  voiceConfig: VoiceConfig,
): Promise<Map<string, ArrayBuffer>> {
  const phrases = new Set<string>();
  for (const words of Object.values(pool.cues)) {
    for (const w of words ?? []) phrases.add(w);
  }
  // 思考フィラー(「うーん」等・Phase C)も同じ neutral スタイルで事前合成する。
  for (const w of pool.thinkingFiller ?? []) phrases.add(w);
  // 相槌は neutral を少しゆっくり(機械的さを和らげる・前のめり感の緩和)。
  const base = resolveStyle(voiceConfig, 'neutral');
  const opts = { ...base, speedScale: (base.speedScale ?? 1) * BACKCHANNEL_SPEED_SCALE };
  const map = new Map<string, ArrayBuffer>();
  for (const phrase of phrases) {
    try {
      map.set(phrase, await tts.speak(phrase, opts));
    } catch (e) {
      log.warn(`backchannel prewarm failed for a phrase: ${(e as Error).name}`);
    }
  }
  return map;
}

import { log } from '../shared/logger';
import {
  BACKCHANNEL_SPEED_SCALE,
  BACKCHANNEL_VOLUME_SCALE,
  BACKCHANNEL_VOICE_RATIO,
} from '../shared/constants';
import { BackchannelEngine } from '../conversation/backchannel-engine';
import { selectBackchannel } from '../conversation/backchannel-pool';
import { loadBackchannelPool } from '../character/backchannel-loader';
import { resolveStyle } from '../character/voice-loader';
import type { BackchannelPoolData } from '../shared/types/backchannel';
import type { TtsEngine, VoiceConfig } from '../shared/types/voice';

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
  /** 相槌を送る。wav があれば音声再生、null なら**うなずきのみ**(音声未準備時/交互の無音側)。 */
  send: (wav: ArrayBuffer | null) => void;
  /** 思考フィラーの表示文字列を吹き出しへ送る(任意・熟考の入りを文字でも見せる)。 */
  sendFillerText?: (text: string) => void;
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
  /** 事前合成の自動再試行回数(TTS 起動待ち・上限あり)。 */
  private prepareRetries = 0;
  private static readonly MAX_PREPARE_RETRIES = 8;
  private static readonly PREPARE_RETRY_MS = 3000;

  constructor(private readonly deps: BackchannelDeps) {}

  /**
   * pool ロード＋相槌/フィラーの事前合成を試みる(best-effort)。
   * 起動直後は TTS(音声エンジン)未起動で音声0件になりうるため、**音声が揃うまで数秒間隔で自動再試行**する
   * (会話開始前に相槌/フィラーの音を用意する)。pool さえ読めれば「うなずき」は音声なしでも動く。
   */
  async prepare(): Promise<void> {
    if (this.synth && this.synth.size > 0) return; // 音声まで準備済み=完了
    this.preparing ??= this.doPrepare().finally(() => {
      this.preparing = null;
    });
    await this.preparing;
    // TTS 未起動等で音声がまだ揃っていなければ、上限まで数秒後に自動再試行(起動後に温まる)。
    if (
      (!this.synth || this.synth.size === 0) &&
      this.prepareRetries < BackchannelController.MAX_PREPARE_RETRIES
    ) {
      this.prepareRetries += 1;
      setTimeout(() => void this.prepare(), BackchannelController.PREPARE_RETRY_MS);
    }
  }

  private async doPrepare(): Promise<void> {
    try {
      this.pool ??= await loadBackchannelPool(this.deps.characterId);
      if (!this.pool) return; // backchannels.json なし → 相槌なし
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
   * 1フレームの発話確率を投入(ENE 非発話中=ユーザの番にのみ呼ぶこと)。
   * 相槌を打つべきなら送る。**タイミング(=うなずき)は pool だけで動く**(音声は任意・あれば一緒に鳴る)。
   * 語は continuer(韻律トーン判定 Lv2 は撤去・2026-06-10)。
   */
  onFrame(prob: number): void {
    if (!this.pool) return;
    const decision = this.engine.push(prob);
    if (!decision) return;
    const phrase = selectBackchannel(this.pool, decision.cue, this.deps.rng, this.lastPhrase);
    this.lastPhrase = phrase;
    // うなずき(無音)と音声をだいたい交互に(毎回声が出てうっとおしいのを防ぐ・ユーザー要望)。
    //   声を出す回=合成 WAV / 出さない回=null(=うなずきのみ)。音声未準備時も null。
    const voiced = this.deps.rng() < BACKCHANNEL_VOICE_RATIO;
    const wav = voiced ? (this.synth?.get(phrase) ?? null) : null;
    log.info('backchannel'); // §6.2: 本文は出さない
    this.deps.send(wav);
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
    // 吹き出しに「考えている」文字列を表示(合成用の長音 ーー は表示では 1 つに畳む)。
    this.deps.sendFillerText?.(phrase.replace(/ー{2,}/g, 'ー'));
    this.deps.send(wav); // フィラーは交互対象外=常に声(準備済みなら)
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
  // 思考フィラー(「そうね」等・Phase C)も同じ neutral スタイルで事前合成する。
  for (const w of pool.thinkingFiller ?? []) phrases.add(w);
  // 相槌/フィラーは neutral を少しゆっくり＋控えめ音量。語ごとの accent 上書き(例「そうね」=頭高)も反映。
  const base = resolveStyle(voiceConfig, 'neutral');
  const map = new Map<string, ArrayBuffer>();
  for (const phrase of phrases) {
    const opts = {
      ...base,
      speedScale: (base.speedScale ?? 1) * BACKCHANNEL_SPEED_SCALE,
      volumeScale: (base.volumeScale ?? 1) * BACKCHANNEL_VOLUME_SCALE,
      accent: pool.accents?.[phrase],
    };
    try {
      map.set(phrase, await tts.speak(phrase, opts));
    } catch (e) {
      log.warn(`backchannel prewarm failed for a phrase: ${(e as Error).name}`);
    }
  }
  return map;
}

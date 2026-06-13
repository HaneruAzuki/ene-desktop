import { powerMonitor, type BrowserWindow } from 'electron';
import { log } from '../../shared/logger';
import { nowLocalIso } from '../../shared/datetime';
import { timeOfDayLabel } from '../../shared/moment';
import {
  IDLE_TALK_CHECK_INTERVAL_MS,
  IDLE_TALK_ENABLED_ENV,
  DAILY_LIFE_CATEGORY,
} from '../../shared/constants';
import {
  shouldSpeakIdle,
  buildIdleTalkPrompt,
  parseIdleTalkResponse,
  type IdleTalkState,
} from '../../conversation/idle-talk';
import { makeLlmComplete } from '../../conversation/client';
import { speakResponse } from './voice-runtime';
import { loadAllEpisodicFiles } from '../../memory/episodic';
import {
  selectOpenLoops,
  loadOpenLoopState,
  saveOpenLoopState,
  type OpenLoopSurface,
} from '../../memory/open-loops';
import { appendShortTerm } from '../../memory/short-term';
import { loadAppSettings } from '../../shared/node/app-settings';
import type { EmotionLabel } from '../../shared/types/animation';
import type { ConversationResponse } from '../../shared/types/conversation';
import type { AppRuntime } from './app-runtime';

// 自発発話マネージャ(P7・N-PRES-7)。タイマーで定期的に「いま自分から一言かけてよいか」を判定し、
// 良ければ材料(気にかけ/今日の暮らし/時間帯)から短い一言を生成して吹き出し＋音声で出す。
//
// 音声は通常応答と同じ speakResponse→voice-chunk 経路を通す:
//  - push-to-talk(既定): マイクは押下中のみON=自声を拾わない(完全に安全)。
//  - ハンズフリー: 相槌(待受中にトリミが音を出す)で実証済みのエコーガード(再生中はマイク入力を無視)を継承する。
// 判定は純粋(idle-talk.ts)・本クラスは配線のみ。すべて best-effort:失敗しても会話・起動に影響させない。

const VALID_EMOTIONS: ReadonlyArray<EmotionLabel> = [
  'neutral', 'joy', 'anger', 'sorrow', 'surprise', 'embarrassed',
];

function toEmotion(v: string | undefined): EmotionLabel {
  return v && (VALID_EMOTIONS as readonly string[]).includes(v) ? (v as EmotionLabel) : 'neutral';
}

interface Material {
  hasMaterial: boolean;
  openLoops: string[];
  recentLife: string[];
  timeOfDay: string;
  /** 今回の気にかけ選択を反映した注入履歴(実際に発話できたら emit が保存する=会話経路と上限を共有)。 */
  openLoopState?: Record<string, OpenLoopSurface>;
}

export class IdleTalkManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastIdleTalkMs: number | null = null;
  private countToday = 0;
  private countDate = '';

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly runtime: AppRuntime,
  ) {}

  /** 監視を開始する(best-effort・失敗しても起動に影響させない)。 */
  start(): void {
    try {
      this.timer = setInterval(() => void this.tick(), IDLE_TALK_CHECK_INTERVAL_MS);
    } catch (e) {
      log.warn('idle talk start failed', { name: (e as Error).name });
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 日付が変わったら今日の回数をリセットする。 */
  private rollDate(todayYmd: string): void {
    if (this.countDate !== todayYmd) {
      this.countDate = todayYmd;
      this.countToday = 0;
    }
  }

  private async tick(): Promise<void> {
    try {
      const { charContext, apiKey } = this.runtime;
      if (!charContext || !apiKey) return;
      if (this.mainWindow.isDestroyed()) return;
      if (this.runtime.away) return; // 離席中は自分から話しかけない(UI改修 段階5)

      const settings = await loadAppSettings();
      // 設定 off か env で明示無効なら黙る。既定は low(有効)。
      const enabled = (settings.idleTalk ?? 'low') !== 'off' && process.env[IDLE_TALK_ENABLED_ENV] !== '0';

      const now = Date.now();
      const d = new Date();
      const todayYmd = nowLocalIso().slice(0, 10);
      this.rollDate(todayYmd);

      const base: Omit<IdleTalkState, 'hasMaterial'> = {
        enabled,
        nowMs: now,
        hour: d.getHours(),
        lastConversationMs: this.runtime.lastActivityMs ?? null,
        lastIdleTalkMs: this.lastIdleTalkMs,
        idleTalkCountToday: this.countToday,
        osIdleSec: powerMonitor.getSystemIdleTime(),
      };

      // 安価ゲートで早期に弾く(材料の I/O を避ける)=材料があると仮定して判定。
      if (!shouldSpeakIdle({ ...base, hasMaterial: true })) return;

      const material = await this.gatherMaterial();
      if (!shouldSpeakIdle({ ...base, hasMaterial: material.hasMaterial })) return;

      await this.emit(material);
    } catch (e) {
      log.warn('idle talk tick failed', { name: (e as Error).name });
    }
  }

  /**
   * 開発用:発火ゲートを無視して今すぐ1回鳴らす(右クリックメニュー「(開発)自発発話を今すぐ」から)。
   * 材料が無くても時間帯の一言を生成する。実機での吹き出し/音声/ハンズフリー自己トリガ確認に使う。
   */
  async triggerNow(): Promise<void> {
    try {
      await this.emit(await this.gatherMaterial());
    } catch (e) {
      // status を併記(401=APIキー不正/失効・undefined=接続その他)。会話内容は出さない(§6.2)。
      log.warn('idle talk triggerNow failed', {
        name: (e as Error).name,
        status: (e as { status?: number }).status,
      });
    }
  }

  /** 生成 → 吹き出し送出 ＋ 音声 ＋ 短期記憶。tick(ゲート通過後)と triggerNow(強制)で共用。 */
  private async emit(material: Material): Promise<void> {
    const { charContext, apiKey, tts, voiceConfig } = this.runtime;
    if (!charContext || !apiKey || this.mainWindow.isDestroyed()) return;

    const msg = await this.generate(charContext.systemPrompt, apiKey, material);
    if (!msg) return;

    // 発火を記録(間隔・上限の更新)。
    this.lastIdleTalkMs = Date.now();
    this.countToday += 1;

    // 気にかけを実際に持ち出す機会を1回使った=注入履歴を確定保存(会話経路と同じ state を共有し、上限1で休眠させる)。
    // 黙ったまま(msg=null)では保存しない=機会を使っていないので上限を消費しない。
    if (material.openLoops.length > 0 && material.openLoopState) {
      try {
        await saveOpenLoopState({ surfaced: material.openLoopState });
      } catch (e) {
        log.warn('idle talk open-loop state save failed', { name: (e as Error).name });
      }
    }

    // 短期記憶に assistant ターンとして残す(以降の会話に接続できる)。
    await appendShortTerm({ role: 'assistant', text: msg.message, timestamp: nowLocalIso(), extracted: false });

    const emotion = toEmotion(msg.emotion);
    const response: ConversationResponse = { type: 'chat', message: msg.message, emotion };
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ene:proactive-message', response);
    }
    // 音声があれば喋る(通常応答と同じ speakResponse→voice-chunk 経路=エコーガードは相槌で実証済みの経路を継承)。
    // push-to-talk(既定)はマイクが押下中のみ=自声を拾わない。ハンズフリーは相槌と同じ再生ガードで保護される。
    if (tts && voiceConfig) void speakResponse(msg.message, emotion, tts, voiceConfig, this.mainWindow);
    log.info('idle talk emitted');
  }

  /** 話す材料(気にかけ/今日の暮らし)と時間帯を集める。 */
  private async gatherMaterial(): Promise<Material> {
    const d = new Date();
    const timeOfDay = timeOfDayLabel(d.getHours());
    try {
      const all = await loadAllEpisodicFiles();
      // 会話経路と同じ気にかけ選択を使う(上限・クールダウン・休眠を共有)。
      // ここでは選択だけ行い、実際に発話できたら emit で state を保存する(黙ったまま上限を消費しない)。
      const state = await loadOpenLoopState();
      const sel = selectOpenLoops(all, state, d.getTime(), nowLocalIso());
      const recentLife = all
        .filter((r) => r.memory.category === DAILY_LIFE_CATEGORY)
        .sort((a, b) => b.memory.date.localeCompare(a.memory.date))
        .slice(0, 2)
        .map((r) => r.memory.summary);
      return {
        hasMaterial: sel.notes.length > 0 || recentLife.length > 0,
        openLoops: sel.notes,
        recentLife,
        timeOfDay,
        openLoopState: sel.surfaced,
      };
    } catch {
      return { hasMaterial: false, openLoops: [], recentLife: [], timeOfDay };
    }
  }

  private async generate(
    systemPrompt: string,
    apiKey: string,
    material: Material,
  ): Promise<{ message: string; emotion?: string } | null> {
    const prompt = buildIdleTalkPrompt({
      systemPrompt,
      timeOfDay: material.timeOfDay,
      openLoops: material.openLoops,
      recentLife: material.recentLife,
    });
    const raw = await makeLlmComplete(apiKey)({ system: prompt.system, user: prompt.user, maxTokens: 256 });
    return parseIdleTalkResponse(raw);
  }
}

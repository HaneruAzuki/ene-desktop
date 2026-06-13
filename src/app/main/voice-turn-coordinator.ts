import { log } from '../../shared/logger';
import type { ConversationResponse } from '../../shared/types/conversation';
import {
  VAD_PROVISIONAL_SILENCE_MS,
  COALESCE_WINDOW_MIN_MS,
  COALESCE_WINDOW_MAX_MS,
  COALESCE_WINDOW_STEP_DOWN_MS,
  COALESCE_WINDOW_STEP_UP_MS,
  LISTENING_WINDOW_MS,
  LISTENING_ENTER_SILENT_CANCELS,
  LISTENING_MAX_CHARS,
  LISTENING_YAWN_MS,
} from '../../shared/constants';

/** 傾聴入室後、この時間ユーザの発話が無ければ自動退室する(姿勢を戻す・固着回避・listening-mode)。 */
const LISTENING_IDLE_TIMEOUT_MS = 20_000;

/** 無音窓(ms)を下限/上限でクランプする(案①・純粋)。 */
export function clampWindow(ms: number): number {
  return Math.round(Math.min(COALESCE_WINDOW_MAX_MS, Math.max(COALESCE_WINDOW_MIN_MS, ms)));
}

// ハンズフリーの投機生成＋コアレッシング(段階①・2026-06-10・ENE_COALESCE ゲート)。
//
// 狙い(ユーザー設計): どのみち Claude の応答には時間がかかる。その死に時間を「待ち窓」に使う。
//  ・短い無音(暫定ターン終了 500ms)で「終わったと仮定」して**裏で生成を開始**(まだ無音)。
//  ・トリミが話し始める(=第一声=コミット)前にユーザが再開したら、**静かにキャンセル**して
//    これまでのテキスト＋追加テキストで生成し直す(連結=コアレッシング)。
//  ・第一声が出た後(コミット後)はキャンセルしない=従来の barge-in に委ねる。
//
// 副作用(記憶書き込み/OSコマンド/誕生日)は **commit(=生成完了かつ非キャンセル時)** にのみ行う。
// 投機実行が捨てられても短期記憶を汚さないため、生成(generate)と確定(commit)を分離して注入する。
//
// このクラスは I/O を持たない純粋な状態機械(generate/commit/emitResponse は DI)=単体テスト対象。

export interface VoiceTurnDeps {
  /**
   * 応答を生成する(投機可・中断可)。
   *  - signal: 中断シグナル(再開/陳腐化で abort)。abort されたら生成を止め、音声を出さないこと。
   *  - onFirstAudio: 第一声(=コミット点)を通知。これ以降の再開は静かなキャンセルにしない。
   *  返り値は確定 ConversationResponse(吹き出し/記憶用)。中断/失敗時は例外でも可。
   */
  generate: (text: string, signal: AbortSignal, onFirstAudio: () => void) => Promise<ConversationResponse>;
  /** 副作用(記憶書き込み/OSコマンド実行/誕生日記録)。生成完了かつ非キャンセル時のみ呼ぶ。 */
  commit: (text: string, response: ConversationResponse) => Promise<void>;
  /** 確定応答を renderer の UI(吹き出し/表情)へ反映する。 */
  emitResponse: (response: ConversationResponse) => void;
  /** 適応(段階②): 算出した無音窓(ms)を VadSegmenter へ反映する(任意)。 */
  setSilenceWindow?: (ms: number) => void;
  /** barge-in(生成完了後): 最新 assistant 記憶を「聞かせた分」へ上書きする(切り詰め・Phase B・任意)。 */
  updateLastAssistant?: (heardText: string) => void;
  /** 傾聴モードの有効/無効(env ゲート)。未指定は有効扱い。無効なら行動入室・あくび等を一切行わない。 */
  listeningEnabled?: boolean;
  /** 現在時刻(ms)。あくびの経過判定に使う(テストで注入可)。未指定は Date.now。 */
  now?: () => number;
  /** 傾聴モードの出入りを renderer へ通知(頬杖姿勢の出し入れ・Phase 4 で配線・任意)。 */
  onListeningChange?: (listening: boolean) => void;
  /** 長時間傾聴のあくびを renderer へ通知(VRM/Few-shot・Phase 4 で配線・任意)。 */
  onYawn?: () => void;
}

/** 進行中の生成の状態。 */
interface ActiveGen {
  ctrl: AbortController;
  /** 第一声が出た(=コミット点)。これ以降の再開は静かなキャンセルにしない。 */
  committed: boolean;
  /** このターンのユーザ発話(barge-in 時に「ユーザ＋聞かせた分」を記憶するのに使う)。 */
  text: string;
  /** barge-in で切り詰め済み(=この生成の通常コミットを抑止)。 */
  bargedIn: boolean;
}

export class VoiceTurnCoordinator {
  /** 未コミットで連結中のテキスト(再開で捨てずに次へ繋ぐ)。 */
  private pendingText = '';
  /**
   * ユーザがいま発話中か。**STT は 1〜2.5秒かかる**ので「無音検出(speech-end)→ STT → onProvisionalEnd」の
   * 間にユーザが再開しうる。その場合 onProvisionalEnd 時点で userSpeaking=true なので**生成を始めず溜めるだけ**にする
   * (=再開がキャンセル対象の生成より先に来てしまう不具合の根本対策)。
   */
  private userSpeaking = false;
  /** 進行中の生成。committed=第一声が出た(=これ以降は静かなキャンセルにしない)。 */
  private gen: ActiveGen | null = null;
  /** 現在の無音窓(ms・案①でイベントごとに伸縮)。VadSegmenter と同期(初期=暫定値)。同一稼働中は保持。 */
  private currentWindowMs = VAD_PROVISIONAL_SILENCE_MS;

  // --- 傾聴モード(docs/listening-mode-design.md) ---
  /** 傾聴モード中か。true の間は適応窓を停止し、固定の長い窓で「終わりまで聞く」。 */
  private listening = false;
  /** 連続サイレントキャンセル数(コミットでリセット)。閾値到達で傾聴入室(行動経路)。 */
  private consecutiveSilentCancels = 0;
  /** 傾聴入室前の無音窓(退室時に復元し、適応の学習値を失わない)。 */
  private windowBeforeListening = VAD_PROVISIONAL_SILENCE_MS;
  /** 傾聴に入った時刻(ms・あくびの経過判定の基点)。 */
  private listeningStartMs = 0;
  /** この傾聴セッションで既にあくびを出したか(1回だけ)。 */
  private yawnedThisListening = false;
  /** 傾聴のアイドル退室タイマ(発話のたびに張り直す)。放置で姿勢が傾いたまま固着するのを防ぐ。 */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 現在時刻(ms)。注入可(テスト)。 */
  private readonly now: () => number;

  constructor(private readonly deps: VoiceTurnDeps) {
    this.now = deps.now ?? ((): number => Date.now());
  }

  /** 傾聴モードが有効か(env ゲート。未指定は有効扱い)。 */
  private get listeningEnabled(): boolean {
    return this.deps.listeningEnabled !== false;
  }

  /**
   * Claude 経路の入室口(明示宣言「プレゼン聞いて」の応答に相乗りしたフラグから呼ぶ・Phase 3)。
   * 行動経路(連続サイレントキャンセル)とは別の、確信の高い入室トリガ。
   */
  requestListening(): void {
    if (this.listeningEnabled && !this.listening) this.enterListening();
  }

  /** 傾聴モードへ入る:適応窓を退避→固定窓へ差し替え→姿勢/あくび状態を初期化。 */
  private enterListening(): void {
    this.listening = true;
    this.windowBeforeListening = this.currentWindowMs;
    this.currentWindowMs = LISTENING_WINDOW_MS;
    this.listeningStartMs = this.now();
    this.yawnedThisListening = false;
    this.deps.setSilenceWindow?.(LISTENING_WINDOW_MS);
    this.deps.onListeningChange?.(true);
    this.armIdleTimer(); // 放置されたら自動退室(姿勢を戻す)
    log.info(`listening: enter (window=${LISTENING_WINDOW_MS}ms)`); // §6.2: 数値のみ
  }

  /** 傾聴モードを抜ける:窓を入室前の値へ復元し、適応を再開する。 */
  private exitListening(): void {
    if (!this.listening) return;
    this.listening = false;
    this.clearIdleTimer();
    this.currentWindowMs = this.windowBeforeListening;
    this.deps.setSilenceWindow?.(this.windowBeforeListening);
    this.deps.onListeningChange?.(false);
    log.info(`listening: exit (window=${this.windowBeforeListening}ms)`);
  }

  /** 傾聴のアイドル退室タイマを張り直す(発話のたびにリセット)。unref で本タイマがプロセスを延命しない。 */
  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.exitListening(); // 一定時間 発話が無い=もう聞く相手がいない → 姿勢を戻す
    }, LISTENING_IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** 長時間傾聴のあくび(1セッション1回・経過のみで判定=保存スカラーを持たない)。 */
  private maybeYawn(): void {
    if (this.yawnedThisListening) return;
    if (this.now() - this.listeningStartMs < LISTENING_YAWN_MS) return;
    this.yawnedThisListening = true;
    this.deps.onYawn?.();
    log.info('listening: yawn');
  }

  /** 発話開始(speech-start)。未コミットの投機生成を静かに中断し、発話中フラグを立てる。 */
  onSpeechStart(): void {
    this.userSpeaking = true;
    if (this.listening) this.armIdleTimer(); // 傾聴中の発話=アクティブ → アイドル退室を先送り
    if (this.gen && !this.gen.committed) {
      this.gen.ctrl.abort();
      // サイレントキャンセル(第一声前)=声が出る前に捕捉できた=余裕あり → 窓を短く(キビキビへ・案①)。
      // (傾聴中は adjustWindow が no-op になる=固定窓を守る)
      this.adjustWindow(-COALESCE_WINDOW_STEP_DOWN_MS);
      // 行動入室:返事しようとするたびユーザが話し続ける=連続サイレントキャンセル。
      // 閾値に達したら傾聴へ(コミットでリセットされるので「連続」のみ数える)。
      this.consecutiveSilentCancels += 1;
      if (
        this.listeningEnabled &&
        !this.listening &&
        this.consecutiveSilentCancels >= LISTENING_ENTER_SILENT_CANCELS
      ) {
        this.enterListening();
      }
    }
  }

  /** 発話終了(speech-end・STT 開始の直前)。発話中フラグを下ろす(この後 STT→onProvisionalEnd)。 */
  onSpeechEnd(): void {
    this.userSpeaking = false;
  }

  /**
   * barge-in のタイミング分類(案①・vad-runtime が判定)。
   *  - isEarly=true(無音開始〜MAX窓以内の被せ)= 窓を延ばせば防げた=まだ喋ってた → 窓を長く。
   *  - isEarly=false(MAX窓超)= 本物の割り込み=窓では直せない → 中立。
   */
  onBargeInTiming(isEarly: boolean): void {
    if (isEarly) this.adjustWindow(COALESCE_WINDOW_STEP_UP_MS);
  }

  /** 無音窓を delta(ms)動かしクランプして反映する(変化があれば setSilenceWindow)。 */
  private adjustWindow(deltaMs: number): void {
    // 傾聴中は固定窓(LISTENING_WINDOW_MS)を守るため適応を停止(無音窓ノブの二重書き回避)。
    if (this.listening) return;
    const next = clampWindow(this.currentWindowMs + deltaMs);
    if (next !== this.currentWindowMs) {
      this.currentWindowMs = next;
      this.deps.setSilenceWindow?.(next);
    }
  }

  /**
   * トリミ発話中の barge-in(=コミット後の割り込み・Phase B)。**聞かせた分(heardText)だけを記憶**し、
   * これ以上喋らせない。heardText は renderer(実際に再生した文)が源泉。
   *  - 生成中(まだ完了していない): 中断して「ユーザ発話＋聞かせた分」をコミット(全文を覚えない)。
   *  - 生成完了済み(全文を記憶済み): 最新 assistant を聞かせた分へ上書き(切り詰め)。
   * 第一声前(未コミット)は barge-in ではない(=サイレントキャンセル領域)→ 何もしない。
   */
  onBargeIn(heardText: string): void {
    const g = this.gen;
    if (g && g.committed) {
      g.bargedIn = true; // 通常コミットを抑止
      g.ctrl.abort(); // これ以上の合成/送出を止める
      this.gen = null;
      log.info(`barge-in mid-gen: aborted, memorize heard ${heardText.length} chars`); // §6.2: 文字数のみ
      void this.deps.commit(g.text, { type: 'chat', message: heardText });
    } else if (!g) {
      log.info(`barge-in post-gen: truncate last assistant to ${heardText.length} chars`);
      this.deps.updateLastAssistant?.(heardText);
    }
  }

  /**
   * 暫定ターン終了(無音 → STT 完了テキスト)。これまでのテキストに連結する。
   * **ユーザがまだ喋っている(STT 中に再開した)なら生成は始めず溜めるだけ**=次の区切りで連結して生成する。
   * 黙っていれば(=本当に話し終わり候補)投機生成を開始する。
   */
  onProvisionalEnd(text: string): void {
    const t = text.trim();
    if (!t) return;
    if (this.gen && !this.gen.committed) this.gen.ctrl.abort();
    this.pendingText = this.pendingText ? `${this.pendingText} ${t}` : t;
    // 傾聴中:あくびの経過判定(≤30秒ごとに来る暫定終了で見る=常駐タイマー不要)。
    if (this.listening) this.maybeYawn();
    // 傾聴中の入力上限:超えたら「聞いた分」で強制的に返事して区切る(荒らし/超長文の有界化)。
    // pendingText を即クリアして以降を新ターンにし、無限蓄積を断つ(ユーザがまだ喋っていても切る)。
    if (this.listening && this.pendingText.length > LISTENING_MAX_CHARS) {
      const snapshot = this.pendingText;
      this.pendingText = '';
      log.info(`listening: input cap reached (${snapshot.length} chars), force respond`); // §6.2: 文字数のみ
      void this.startGeneration(snapshot);
      return;
    }
    if (!this.userSpeaking) void this.startGeneration(this.pendingText);
  }

  /** ハンズフリー終了/リセット。進行中を中断し状態を空にする(currentWindowMs=学習値は保持)。 */
  reset(): void {
    if (this.gen) this.gen.ctrl.abort();
    this.gen = null;
    this.pendingText = '';
    this.userSpeaking = false;
    // 傾聴状態も初期化(窓は入室前の学習値へ戻す=6000を残さない)。
    if (this.listening) {
      this.listening = false;
      this.currentWindowMs = this.windowBeforeListening;
      this.deps.onListeningChange?.(false);
    }
    this.clearIdleTimer();
    this.consecutiveSilentCancels = 0;
  }

  private async startGeneration(text: string): Promise<void> {
    const ctrl = new AbortController();
    const g: ActiveGen = { ctrl, committed: false, text, bargedIn: false };
    this.gen = g;
    try {
      const response = await this.deps.generate(text, ctrl.signal, () => {
        g.committed = true;
        // 第一声が出た=このターンは確定。以降の発話(barge-in 等)は新ターン=連結しない。
        this.pendingText = '';
        // トリミが実際に喋った=「連続」サイレントキャンセルが途切れた → カウンタを戻す。
        this.consecutiveSilentCancels = 0;
        // 傾聴の出口:返事を始めた=聞くターンは終わり → 通常モード(適応窓)へ戻す。
        this.exitListening();
      });
      // 中断済み / 自分が最新でない / barge-in で切り詰め済み なら通常コミットを破棄。
      if (ctrl.signal.aborted || this.gen !== g || g.bargedIn) return;
      // コミット: pending を消費し、UI 反映 → 副作用。窓の調整はイベント(キャンセル/barge-in)側で行う(案①)。
      this.pendingText = '';
      this.gen = null;
      this.deps.emitResponse(response);
      await this.deps.commit(text, response);
      // Claude入室(明示宣言・listening-mode): 応答に enterListening が立っていたら傾聴へ。
      // 「わかった」第一声のコミット(onFirstAudio)で一度 exitListening 済なので、ここで改めて入室する。
      if (response.type === 'chat' && response.enterListening) this.requestListening();
    } catch (e) {
      // 中断(投機キャンセル/reset)は想定内=無言で破棄。それ以外の失敗は記録する(原因究明・§6.2 名前のみ)。
      if (!ctrl.signal.aborted) {
        log.warn(`voice turn generation failed (not aborted): ${(e as Error).name}`);
      }
      // 破棄(pending は保持し次の end で連結)。自分が最新なら掃除。
      if (this.gen === g) this.gen = null;
    }
  }
}

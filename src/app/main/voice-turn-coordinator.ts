import { log } from '../../shared/logger';
import type { ConversationResponse } from '../../shared/types/conversation';
import {
  VAD_PROVISIONAL_SILENCE_MS,
  COALESCE_WINDOW_MIN_MS,
  COALESCE_WINDOW_MAX_MS,
  COALESCE_WINDOW_STEP_DOWN_MS,
  COALESCE_WINDOW_STEP_UP_MS,
} from '../../shared/constants';

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

  constructor(private readonly deps: VoiceTurnDeps) {}

  /** 発話開始(speech-start)。未コミットの投機生成を静かに中断し、発話中フラグを立てる。 */
  onSpeechStart(): void {
    this.userSpeaking = true;
    if (this.gen && !this.gen.committed) {
      this.gen.ctrl.abort();
      // サイレントキャンセル(第一声前)=声が出る前に捕捉できた=余裕あり → 窓を短く(キビキビへ・案①)。
      this.adjustWindow(-COALESCE_WINDOW_STEP_DOWN_MS);
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
    if (!this.userSpeaking) void this.startGeneration(this.pendingText);
  }

  /** ハンズフリー終了/リセット。進行中を中断し状態を空にする(currentWindowMs=学習値は保持)。 */
  reset(): void {
    if (this.gen) this.gen.ctrl.abort();
    this.gen = null;
    this.pendingText = '';
    this.userSpeaking = false;
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
      });
      // 中断済み / 自分が最新でない / barge-in で切り詰め済み なら通常コミットを破棄。
      if (ctrl.signal.aborted || this.gen !== g || g.bargedIn) return;
      // コミット: pending を消費し、UI 反映 → 副作用。窓の調整はイベント(キャンセル/barge-in)側で行う(案①)。
      this.pendingText = '';
      this.gen = null;
      this.deps.emitResponse(response);
      await this.deps.commit(text, response);
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

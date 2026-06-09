import { log } from '../shared/logger';
import type { ConversationResponse } from '../shared/types/conversation';
import {
  COALESCE_CANCEL_EMA_ALPHA,
  COALESCE_WINDOW_BASE_MS,
  COALESCE_WINDOW_GAIN_MS,
  COALESCE_WINDOW_MIN_MS,
  COALESCE_WINDOW_MAX_MS,
} from '../shared/constants';

/**
 * 適応(段階②): ターンごとのサイレントキャンセル数を EMA で均し、無音窓(ms)を算出する(純粋)。
 * 窓 = clamp(BASE + GAIN×ema, MIN, MAX)。キャンセルが増える(=窓が短く、まだ喋り終わっていないのに
 * 生成が走る)ほど窓が広がり、皆無なら基準まで縮む。barge-in は信号に含めない(ユーザー指摘)。
 */
export function adaptWindow(
  prevEma: number,
  cancelsThisTurn: number,
): { ema: number; windowMs: number } {
  const ema = (1 - COALESCE_CANCEL_EMA_ALPHA) * prevEma + COALESCE_CANCEL_EMA_ALPHA * cancelsThisTurn;
  const raw = COALESCE_WINDOW_BASE_MS + COALESCE_WINDOW_GAIN_MS * ema;
  const windowMs = Math.round(Math.min(COALESCE_WINDOW_MAX_MS, Math.max(COALESCE_WINDOW_MIN_MS, raw)));
  return { ema, windowMs };
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
  private gen: { ctrl: AbortController; committed: boolean } | null = null;
  /** このターン(コミットまで)で起きたサイレントキャンセル数(適応の信号・段階②)。 */
  private silentCancelsThisTurn = 0;
  /** サイレントキャンセル数のEMA(無音窓の算出に使う。同一アプリ稼働中は保持=その人の傾向を学ぶ)。 */
  private cancelEma = 0;

  constructor(private readonly deps: VoiceTurnDeps) {}

  /** 発話開始(speech-start)。未コミットの投機生成を静かに中断し、発話中フラグを立てる。 */
  onSpeechStart(): void {
    this.userSpeaking = true;
    if (this.gen && !this.gen.committed) {
      this.gen.ctrl.abort();
      // 第一声(コミット)前のキャンセル=窓が短く、まだ喋り終わっていなかった証拠(適応の信号・段階②)。
      this.silentCancelsThisTurn++;
    }
  }

  /** 発話終了(speech-end・STT 開始の直前)。発話中フラグを下ろす(この後 STT→onProvisionalEnd)。 */
  onSpeechEnd(): void {
    this.userSpeaking = false;
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

  /** ハンズフリー終了/リセット。進行中を中断し状態を空にする(cancelEma=学習値は保持)。 */
  reset(): void {
    if (this.gen) this.gen.ctrl.abort();
    this.gen = null;
    this.pendingText = '';
    this.userSpeaking = false;
    this.silentCancelsThisTurn = 0; // 中断したターンの途中カウントは破棄(cancelEma は保持)
  }

  private async startGeneration(text: string): Promise<void> {
    const ctrl = new AbortController();
    const g: { ctrl: AbortController; committed: boolean } = { ctrl, committed: false };
    this.gen = g;
    try {
      const response = await this.deps.generate(text, ctrl.signal, () => {
        g.committed = true;
        // 第一声が出た=このターンは確定。以降の発話(barge-in 等)は新ターン=連結しない。
        this.pendingText = '';
      });
      // 中断済み or 自分が最新でない(後続の end が新生成を始めた)なら破棄。
      if (ctrl.signal.aborted || this.gen !== g) return;
      // コミット: pending を消費し、UI 反映 → 適応窓更新 → 副作用。
      this.pendingText = '';
      this.gen = null;
      this.deps.emitResponse(response);
      // 適応(段階②): このターンのサイレントキャンセル数を EMA に反映し、無音窓を更新する。
      const { ema, windowMs } = adaptWindow(this.cancelEma, this.silentCancelsThisTurn);
      this.cancelEma = ema;
      this.silentCancelsThisTurn = 0;
      this.deps.setSilenceWindow?.(windowMs);
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

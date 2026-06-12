import type { ConversationResponse } from './conversation';
import type { CharacterAnimationData } from './animation';
import type { TranscribeResult } from './stt';
import type { VoiceInputMode } from './settings';
import type { VrmRenderConfig, VrmDisplayParams } from './vrm';

// IPC 通信の契約(設計書 §4.2)。Renderer 側は window.ene.* で呼ぶ。

export interface CharacterInfo {
  name: string;
  // portrait は CSP/サンドボックス制約のため data URL で渡す(main 側で PNG を base64 化)。
  portraitUrl: string;
  // アニメ(task_13・任意)。frames は dataURL 群。無ければ単一 portrait 表示にフォールバック。
  animation?: CharacterAnimationData;
}

/**
 * 音声応答のチャンク(WAV)。ストリーミング時は**その文の表示テキストと通し番号**を同梱する
 * (再生開始に同期して吹き出しを1文ずつ伸ばす＋barge-in で「聞かせた分」を確定するため)。
 * 非ストリーミング(speakResponse)は wav のみ(text/index なし=従来どおり全文を別途表示)。
 */
export interface VoiceChunk {
  wav: ArrayBuffer;
  /** この WAV が表す文の表示テキスト(ストリーミングのみ)。 */
  text?: string;
  /** 応答内での文の通し番号(0始まり・先頭文 index=0 で吹き出しをリセットする)。 */
  index?: number;
}

export interface EneAPI {
  // 会話関連
  sendMessage(text: string): Promise<ConversationResponse>;

  // キャラクター関連
  getCharacterInfo(): Promise<CharacterInfo>;

  // --- VRM 表示(F・3D化)。null=未配置/読込失敗→renderer は PNG 立ち絵へフォールバック ---
  // 表情マップ＋初期表示パラメータ(ユーザー上書きマージ済み)。
  getVrmConfig(): Promise<VrmRenderConfig | null>;
  // VRM モデル本体(ArrayBuffer・10MB 規模を base64 化せず渡す・§3.8)。
  getCharacterModel(): Promise<ArrayBuffer | null>;
  // GUI スライダーの調整結果を保存する(高さ/距離/向きY/腕下げ)。
  setVrmDisplay(display: Partial<VrmDisplayParams>): Promise<void>;
  // ウィンドウ可視性の通知(main → renderer)。false=非表示/最小化→描画停止。
  onWindowVisibility(callback: (visible: boolean) => void): void;

  // 起動挨拶(pull 方式・1回だけ取得)
  getInitialGreeting(): Promise<string | null>;

  // ウィンドウ操作
  moveWindow(x: number, y: number): Promise<void>;
  setIgnoreMouseEvents(ignore: boolean): Promise<void>; // クリックスルー制御(§8.6)

  // キャラ右クリックメニュー(main 側でネイティブメニュー表示)
  showCharacterContextMenu(): Promise<void>;

  // 入力欄を開いた瞬間に Tier0 キャッシュを温める(task_14 Phase 3・レイテンシ施策)
  warmCache(): Promise<void>;

  // 音声応答のチャンク(WAV＋任意で文テキスト/通し番号)受信(main → renderer・task_17 Phase A)
  onVoiceChunk(callback: (chunk: VoiceChunk) => void): void;

  // マイク音声(16kHz mono Float32)を文字起こしする(renderer → main・task_17 Phase B)
  transcribeAudio(samples: Float32Array): Promise<TranscribeResult>;

  // --- ハンズフリー音声会話(VAD・task_17 Phase C) ---
  // VAD セッション開始(戻り値 false=モデル未配置で無効)。
  startVad(): Promise<boolean>;
  // マイクの1フレーム(16kHz・512サンプル)を VAD へ送る(連続・一方向)。
  sendVadFrame(frame: Float32Array): void;
  // VAD セッション終了。
  stopVad(): void;
  // ENE 発話中フラグ(barge-in 検出のデバウンス切替・エコー誤割り込み抑制)。
  setVadSpeaking(speaking: boolean): void;
  // 聞き取り状態(main → renderer・UI 表示用)。
  onVoiceState(callback: (state: 'listening' | 'recording' | 'transcribing') => void): void;
  // 話し終わりの確定テキスト(main → renderer)。renderer は sendMessage に流す(非コアレッシング経路)。
  onVoiceTranscript(callback: (text: string) => void): void;
  // コアレッシング(段階①・ENE_COALESCE)の確定応答(main → renderer)。生成は main 側で完結し、
  // renderer は受け取った応答を吹き出し/表情へ反映するだけ(音声は ene:voice-chunk で別途到着済み)。
  onVoiceResponse(callback: (response: ConversationResponse) => void): void;
  // 自発発話(アイドル時・P7)。main がタイマー判定で生成し、renderer は吹き出し/表情へ反映する(音声なし v1)。
  onProactiveMessage(callback: (response: ConversationResponse) => void): void;
  // ENE 発話中の割り込み検出(main → renderer)。renderer は再生を止める。
  onVoiceBargeIn(callback: () => void): void;
  // barge-in 時に「実際に聞かせた発言(再生済みの文を連結)」を main へ報告する(renderer → main・Phase B)。
  // main は記憶を聞かせた分へ切り詰める(トリミが言っていない内容を覚えない)。
  notifyBargeInHeard(text: string): void;

  // マイク入力方式(設定)。取得 ＋ 右クリックメニューでの変更通知(task_17 Phase C)。
  getVoiceInputMode(): Promise<VoiceInputMode>;
  onVoiceInputModeChanged(callback: (mode: VoiceInputMode) => void): void;

  // 相槌受信(main → renderer・task_18 Phase B)。wav があれば再生、null でも**うなずき**は出す。
  onBackchannel(callback: (wav: ArrayBuffer | null) => void): void;

  // ターン終端うなずき(main → renderer・2026-06-12)。無音窓終端で1回うなずく。
  //  strength = うなずきの深さ(相槌の基準 1.0 比・発話が長いほど重め)。音は鳴らさず視覚のみ。
  onTurnNod(callback: (strength: number) => void): void;

  // 思考フィラーの表示文字列(main → renderer・Phase C)。吹き出しに一時表示(応答で上書き)。
  onThinkingFiller(callback: (text: string) => void): void;

  // 起動準備の完了(音声エンジンのヘルス到達＋埋め込みウォーム)。
  //  - isReady: 現在の準備状態を取得(初期表示用・pull)。
  //  - onAppReady: 準備完了の通知(push)。renderer は完了まで「ちょっと待って、」を表示する。
  isReady(): Promise<boolean>;

  // ライフサイクル(main → renderer)
  onAppReady(callback: () => void): void;

  // タスクトレイ/コンテキストメニューからのイベント受信(main → renderer)
  onOpenInputArea(callback: () => void): void;
}

declare global {
  interface Window {
    ene: EneAPI;
  }
}

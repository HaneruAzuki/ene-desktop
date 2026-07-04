import type { ConversationResponse } from './conversation';
import type { TranscribeResult } from './stt';
import type { IdleTalkMode } from './settings';
import type { VrmRenderConfig, VrmDisplayParams } from './vrm';
import type { EqBand } from './voice';

// IPC 通信の契約(設計書 §4.2)。Renderer 側は window.ene.* で呼ぶ。

export interface CharacterInfo {
  name: string;
}

/** 主人の呼び方(＋読み)。設定画面の取得/登録に使う(本名 userFullName は会話で覚える=含めない)。 */
export interface OwnerName {
  name: string; // 呼び方(userName)
  reading: string; // 呼び方の読み(userNameReading・かな・音声用)
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
  // 中断(barge-in / 新ターンによる supersede)で破棄されたターンは null を返す(renderer は UI 反映しない)。
  sendMessage(text: string): Promise<ConversationResponse | null>;

  // キャラクター関連
  getCharacterInfo(): Promise<CharacterInfo>;

  // --- VRM 表示(F・3D化)。null=未配置/読込失敗→renderer は PNG 立ち絵へフォールバック ---
  // 表情マップ＋初期表示パラメータ(ユーザー上書きマージ済み)。
  getVrmConfig(): Promise<VrmRenderConfig | null>;
  // VRM モデル本体(ArrayBuffer・10MB 規模を base64 化せず渡す・§3.8)。
  getCharacterModel(): Promise<ArrayBuffer | null>;
  // GUI スライダーの調整結果を保存する(高さ/距離/向きY/腕下げ)。
  setVrmDisplay(display: Partial<VrmDisplayParams>): Promise<void>;

  // --- 音量・ミュート(トリミの声=出力・UI改修 段階3) ---
  getAudioPrefs(): Promise<{ volume: number; muted: boolean }>;
  saveAudioPrefs(volume: number, muted: boolean): Promise<void>;

  // 声色補正 EQ(voice.json 由来・キャラ依存)。renderer が再生グラフへ挟む。空配列=EQ なし。
  getVoiceEq(): Promise<EqBand[]>;

  // じゃあね(UI改修 段階4): ウィンドウをタスクバーへ最小化する(クリックで戻る)。完全終了は右クリック。
  goodbye(): Promise<void>;

  // 離席(UI改修 段階5): 離席中フラグを main へ通知(自発発話を止める)。renderer→main 一方向。
  setAway(away: boolean): void;

  // --- 設定パネル(UI改修 段階6・⚙) ---
  getIdleTalk(): Promise<IdleTalkMode>;
  saveIdleTalk(mode: IdleTalkMode): Promise<void>;
  openApiKeyDialog(): Promise<void>;
  showAbout(): Promise<void>;
  openDataFolder(): Promise<void>;
  openConsole(): Promise<void>;
  /** 記憶(＋設定)を選択フォルダへ書き出す。api-key は機械固定ゆえ含めない(N-REL-2)。 */
  exportMemory(): Promise<{ ok: boolean; message: string }>;
  /** バックアップフォルダから記憶(＋設定)を上書き復元する。反映には再起動が必要(N-REL-2)。 */
  importMemory(): Promise<{ ok: boolean; message: string }>;
  getAutoLaunch(): Promise<boolean>;
  setAutoLaunch(on: boolean): Promise<void>;
  // 主人の呼び方(＋読み)の取得/登録(本名 userFullName は会話で覚える=設定では扱わない)。
  getOwnerName(): Promise<OwnerName>;
  setOwnerName(name: string, reading: string): Promise<void>;

  // ユーザー発話の確定テキスト(main→renderer)。ハンズフリー音声(コアレッシング含む)で発火し、
  // renderer はこれをアイドル計時のリセット(話しかけられた=前を向く)に使う。
  onUserSaid(callback: (text: string) => void): void;
  // ウィンドウ可視性の通知(main → renderer)。false=非表示/最小化→描画停止。
  onWindowVisibility(callback: (visible: boolean) => void): void;

  // 起動挨拶(pull 方式・1回だけ取得)
  getInitialGreeting(): Promise<string | null>;

  // ウィンドウ操作
  moveWindow(x: number, y: number): Promise<void>;
  setIgnoreMouseEvents(ignore: boolean): Promise<void>; // クリックスルー制御(§8.6)

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

  // 相槌受信(main → renderer・task_18 Phase B)。wav があれば再生、null でも**うなずき**は出す。
  onBackchannel(callback: (wav: ArrayBuffer | null) => void): void;

  // ターン終端うなずき(main → renderer)。無音窓終端で1回うなずく。
  //  strength = うなずきの深さ(相槌の基準 1.0 比・発話が長いほど重め)。音は鳴らさず視覚のみ。
  onTurnNod(callback: (strength: number) => void): void;

  // あくび(main → renderer・listening-mode)。長時間傾聴で1回あくび(口開き+目細め+首+口元へ手)。
  onYawn(callback: () => void): void;

  // 傾聴モードの出入り(main → renderer・listening-mode)。on=傾聴中(少し首をかしげる)。
  onListening(callback: (on: boolean) => void): void;

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

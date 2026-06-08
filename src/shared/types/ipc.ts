import type { ConversationResponse } from './conversation';
import type { CharacterAnimationData } from './animation';
import type { TranscribeResult } from './stt';
import type { VoiceInputMode } from './settings';

// IPC 通信の契約(設計書 §4.2)。Renderer 側は window.ene.* で呼ぶ。

export interface CharacterInfo {
  name: string;
  // portrait は CSP/サンドボックス制約のため data URL で渡す(main 側で PNG を base64 化)。
  portraitUrl: string;
  // アニメ(task_13・任意)。frames は dataURL 群。無ければ単一 portrait 表示にフォールバック。
  animation?: CharacterAnimationData;
}

export interface EneAPI {
  // 会話関連
  sendMessage(text: string): Promise<ConversationResponse>;

  // キャラクター関連
  getCharacterInfo(): Promise<CharacterInfo>;

  // 起動挨拶(pull 方式・1回だけ取得)
  getInitialGreeting(): Promise<string | null>;

  // 設定関連
  hasApiKey(): Promise<boolean>;
  saveApiKey(key: string): Promise<void>;

  // ウィンドウ操作
  moveWindow(x: number, y: number): Promise<void>;
  resetWindowPosition(): Promise<void>;
  setIgnoreMouseEvents(ignore: boolean): Promise<void>; // クリックスルー制御(§8.6)

  // キャラ右クリックメニュー(main 側でネイティブメニュー表示)
  showCharacterContextMenu(): Promise<void>;

  // 入力欄を開いた瞬間に Tier0 キャッシュを温める(task_14 Phase 3・レイテンシ施策)
  warmCache(): Promise<void>;

  // 音声応答のチャンク(WAV)受信(main → renderer・task_17 Phase A)
  onVoiceChunk(callback: (chunk: ArrayBuffer) => void): void;

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
  // 話し終わりの確定テキスト(main → renderer)。renderer は sendMessage に流す。
  onVoiceTranscript(callback: (text: string) => void): void;
  // ENE 発話中の割り込み検出(main → renderer)。renderer は再生を止める。
  onVoiceBargeIn(callback: () => void): void;

  // マイク入力方式(設定)。取得 ＋ 右クリックメニューでの変更通知(task_17 Phase C)。
  getVoiceInputMode(): Promise<VoiceInputMode>;
  onVoiceInputModeChanged(callback: (mode: VoiceInputMode) => void): void;

  // 相槌受信(main → renderer・task_18 Phase B)。wav があれば再生、null でも**うなずき**は出す。
  onBackchannel(callback: (wav: ArrayBuffer | null) => void): void;

  // ライフサイクル(main → renderer)
  onAppReady(callback: () => void): void;
  onError(callback: (error: string) => void): void;

  // タスクトレイ/コンテキストメニューからのイベント受信(main → renderer)
  onOpenInputArea(callback: () => void): void;
  onResetPosition(callback: () => void): void;
}

declare global {
  interface Window {
    ene: EneAPI;
  }
}

import type { ConversationResponse } from './conversation';

// IPC 通信の契約(設計書 §4.2)。Renderer 側は window.ene.* で呼ぶ。

export interface CharacterInfo {
  name: string;
  // portrait は CSP/サンドボックス制約のため data URL で渡す(main 側で PNG を base64 化)。
  portraitUrl: string;
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

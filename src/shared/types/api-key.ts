// APIキー管理ダイアログ関連の型(設計書 §3.7)。

export type ApiKeyTestReason = 'auth' | 'credit' | 'network' | 'other';

export type PingResult =
  | { ok: true }
  | { ok: false; reason: ApiKeyTestReason; detail?: string };

/** ダイアログ専用 Renderer に公開する API(window.eneApiKey)。window.ene とは別。 */
export interface EneApiKeyAPI {
  testApiKey(key: string): Promise<PingResult>;
  saveApiKey(key: string): Promise<void>;
  openAnthropicConsole(): Promise<void>;
  closeDialog(ok: boolean): Promise<void>;
}

declare global {
  interface Window {
    eneApiKey: EneApiKeyAPI;
  }
}

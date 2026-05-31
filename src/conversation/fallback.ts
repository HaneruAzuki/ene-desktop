import type { ConversationResponse } from '../shared/types/conversation';

// フォールバック応答(設計書 §3.4 第4防御 / §6.3)。
// 技術的エラーは見せず、キャラ口調で返す。
// MVP ではここに直書きするが、将来は identity.json から取得できる拡張余地を残す。

export function fallbackResponse(): ConversationResponse {
  return { type: 'chat', message: '…ごめん、なんか調子悪いみたい。もう一回試してみて?' };
}

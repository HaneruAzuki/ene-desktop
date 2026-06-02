import type { ApiKeyTestReason } from '../shared/types/api-key';

// エラー種別ごとのユーザー表示文言(設計書 §3.7「エラー種別ごとのユーザー表示」)。
// 技術的詳細(スタックトレース等)は見せない。純粋関数なので main/renderer 双方から使える。

export function getErrorMessage(reason: ApiKeyTestReason): string {
  switch (reason) {
    case 'auth':
      return 'APIキーが無効です。コピー漏れがないか確認してください。';
    case 'credit':
      return 'クレジット残高が不足しているか、レート上限に達しています。Anthropic Console で確認してください。';
    case 'network':
      return 'Anthropic に接続できませんでした。インターネット接続を確認してください。';
    case 'other':
      return '予期しないエラーが発生しました。';
  }
}

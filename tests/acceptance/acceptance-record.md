# ENE Desktop MVP 受入記録

## バージョン: 0.1.0
## 実施日: 2026-06-03
## 実施者: ユーザー(人間判定)+ Claude(自動テスト・機械検査の代理検証)

> 自動テスト結果は `npm run test` の出力を、手動確認は `manual-check.md` の実施結果を転記する。
> **成功基準8 と、UI/体感を伴う手動項目は人間判定が必須**(CLAUDE §9.3)。本記録の手動項目は
> すべてユーザー自身が実機(本人がダブルクリック起動した配布 exe)で判定した結果である。

## 自動テスト結果(`tests/acceptance/automated/`)
- [x] memory-recall.test.ts(成功基準5 の機構): 合格
- [x] domain-recognition.test.ts(成功基準4 の機構): 合格
- [x] os-command-execution.test.ts(成功基準3 / セキュリティ): 合格
- [x] api-security.test.ts(成功基準6): 合格
- [x] performance.test.ts(成功基準7・exe=約60.9MB): 合格

> `npm run test` 全体: 41 ファイル / 175 tests passing(うち受入 13)。lint・typecheck クリーン。

## 手動確認結果(`manual-check.md`)
- [x] 成功基準1(常駐とドラッグ・位置復元): 合格 ← ユーザー実機確認
- [x] 成功基準2(応答): 合格
- [x] 成功基準3(OS 操作・メモ帳/フォルダ): 合格
- [x] 成功基準4(知らないと返す): 合格
- [x] 成功基準5(記憶): 合格 ← semantic.json に嗜好反映を確認(複数日 recall は機構で担保)
- [x] 成功基準6(API キー暗号化): 合格 ← 平文 sk-ant- なし / v10(DPAPI)マーカーを機械確認
- [x] 成功基準7(配布サイズ・CPU/メモリ): 合格
- [x] **成功基準8(AIっぽくない)**: 合格 ← 最重要・5質問×25項目すべてユーザー判定OK

## 不合格項目とその対応
| 項目 | 内容 | 対応方針 |
|------|------|---------|
| (なし) | 全項目合格 | — |

## MVP 完成判定
- [x] 全項目合格 → **MVP 完成**
- [ ] 不合格あり → 修正タスクを起こして再実施

## 備考(MVP 後ブラッシュアップとして記録済み・docs/implementation-notes.md)
- N-12-4: 雑談的発話が episodic に残りにくい(嗜好は semantic に正しく蓄積)。抽出プロンプト調整は MVP 後。
- N-09-9 / N-09-10 / N-11-1 / N-11-4: Router タイムアウト・抽出頻度・winCodeSign 回避・パッケージ時ログ保存先。

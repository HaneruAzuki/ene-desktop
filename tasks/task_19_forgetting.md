# task_19 忘却機構(Forgetting / Memory Consolidation)

> **位置づけ**:設計書 §11.6「忘却機構」を実装に落とす。ビジョン §3 柱1「人間らしい忘却」の本質機能であり、
> 同時に中期記憶(Episodic)の O(n) 増加を恒久的に抑えるガバナ(optimization-backlog **B-13**)。
> 2026-06-09 ユーザ承認のうえ着手。**破壊的(物理削除)処理のため既定はオフ**。

## 0. 設計判断(本タスクで確定したもの)

| 論点 | 決定 | 根拠 |
|---|---|---|
| サマリの保存表現 | **通常の EpisodicMemory** として保存。`category="summary"`(専用)＋ `extra.summaryTier="monthly"\|"yearly"` ＋ `extra.period` ＋ `extra.sourceCount`。importance=月次4/年次5 | 既存スキーマ/索引/想起をそのまま流用・後方互換・平文 JSON 可搬(§6.1)。新レイヤ不要 |
| サマリの valence | **0(中立)** | mood を動かさない(感情の主役は生の記憶・§5.3) |
| サマリの合成日 | 月次=その月の15日 / 年次=12/31(固定アンカー) | category="summary" 内でファイル名衝突を避ける(`episodicId` は日付由来) |
| 削除の種類 | **物理削除**(`deleteEpisodicById`) | CLAUDE §6.4(論理削除でなく物理削除) |
| トリガ | **起動時に背景実行**(`requestForgetting`・直列化ロック)。冪等(済み期間はサマリ有無で判定) | 起動/会話を妨げない。月次/年次は低頻度 |
| MVP スコープ | **月次＋年次**を実装。5年サマリは後回し(発火は5年後) | §11.6 の主要2段。5年は将来 |
| 有効化 | **環境変数 `ENE_FORGETTING=1` のときだけ**。既定 OFF | 物理削除のため実データ投入前にレビュー |
| 短期ハード上限(採用(a)) | `SHORT_TERM_HARD_MAX=80`(未抽出)で**同期抽出を強制**(`enforceShortTermCap`) | B-01 で外れた短期上限を復活・上限を守りつつ記憶を失わない |

## 1. 段階的縮退(§11.6 準拠)

```
直近1ヶ月: 全詳細(当月は触らない)
  ↓ 月次サマリ(完了した月)…生記録を1件に要約 → importance≤2 を物理削除・≥3 の詳細は残す
1ヶ月〜1年: 重要度≥3 詳細 + 月次サマリ
  ↓ 年次サマリ(currentYear-Y ≥ 2 の年)…月次サマリ＋残存詳細を1件に再要約
                                       → 月次サマリを削除・生記録 importance≤3 を削除・≥4 は残す
1〜5年: 重要度≥4 詳細 + 年次サマリ
```

しきい値は `src/shared/constants.ts`(`FORGET_*`)に外出し(§4.5)。

## 2. 実装ファイル

- `src/memory/consolidation-policy.ts` — **純粋**:全記録＋現在年月 → `{ monthly[], yearly[] }` 計画(削除ID・要約対象)。LLM/IO なし=決定論で単体テスト。
- `src/memory/summarizer.ts` — 期間の記録群を1サマリへ再要約(中立観察者・`LlmComplete` DI)。**失敗時は throw**。
- `src/memory/forgetting.ts` — orchestrator:計画実行(要約→サマリ保存→物理削除→索引整合→state)。**要約に失敗した期間は削除しない**。直列化ロック＋`isForgettingEnabled()` ゲート。
- `src/memory/consolidation-state.ts` — `consolidation-state.json`(最終実行記録・補助)。
- 既存への追加:`episodic.deleteEpisodicById`、`index-vector.pruneVectorIndex`、`datetime.localIsoFromParts`、`paths.getConsolidationStatePath`、`extraction-scheduler.enforceShortTermCap`。
- 配線:`lifecycle.ts` Step 8.5 で `if (isForgettingEnabled()) void requestForgetting(...)`。`ipc.ts` で `enforceShortTermCap` を会話経路に。

## 3. 安全策

- **要約成功 → 削除**の順(サマリ無しで記憶を失わない)。
- 物理削除後、派生索引は `rebuildInvertedIndex()` ＋ `pruneVectorIndex()` で整合(真実の源は episodic 本体・再生成可)。
- canon(`provenance:'self'`)は対象外。
- 既定オフ(`ENE_FORGETTING`)。実データ有効化前にレビュー。

## 4. テスト

- `tests/unit/consolidation-policy.test.ts` — 純粋計画(完了月/当月除外/年次巻き上げ/冪等/canon除外/しきい値)。
- `tests/unit/forgetting.test.ts` — orchestrator 統合(要約→削除→保持→state・要約失敗時の温存・当月不触)。

## 5. 残・将来

- 5年サマリ(§11.6 3段目)。
- 「この記憶を忘れて」ユーザ指示削除(§11.6・別経路)。
- 実機での有効化レビュー＋初回大量統合時のレイテンシ確認(背景実行だが I/O 量に注意)。
- 反映待ち(implementation-notes へ):設計書 §11.6 を「実装済み(月次/年次・既定オフ)」へ更新。

# task_15: 記憶の想起エンジン＋更新フロー（MVP 0.3「記憶の会話活用強化」）

## 目的

「聞かれたら的確に思い出す」「関係を覚えていて自分から触れる」を実現するため、
**全件横断のローカル想起エンジン**と、**記憶の非破壊更新（supersede）フロー**を実装する。

達成できる体験（ショーケース）:
- 「赤点取った」→ 過去の「テスト前に遊ぶ＋ENEが反対」を引き当て「だから言ったでしょ！」
- 「田中さんと喧嘩」→ 話題の違う過去の「田中さん」言及も人物で束ねて想起
- 「実は田中一郎さんだった」「鈴木は友達として好きだった」→ 旧記憶を**非破壊で更新**

> データの**持ち方**は `docs/design-revision-memory-v2.md`（§3.3/§5.2 改訂）に定義済み。
> 本タスクは**振る舞い（想起・更新の処理）**を実装する。コスト最適化（Tier/キャッシュ）は
> task_14 の別スコープ。忘却・統合（§11.6）と能動的想起（follow-up）は本タスクの範囲外（将来）。

## 依存タスク

- task_03（Memory Layer）、task_04（Knowledge Router）、task_05（Conversation Layer）完了済み
- `docs/design-revision-memory-v2.md` のデータモデルが承認済みであること

## 関連ドキュメント

- `docs/design-revision-memory-v2.md` — データモデル v2（型・ディレクトリ・マイグレーション）
- `docs/03_design.md` §3.3（Memory Layer）/ §11.4（高度な記憶検索＝本タスクで前倒し）/ §11.6（忘却・将来）
- `docs/00_philosophy.md` — 北極星（覚えている／関係の深化）、3設計則
- `CLAUDE.md` §4.4（疎結合）/ §5.1（キャラ差し替え可能＝記憶は中立）/ §6.1（可搬性）/ §7.1（外部送信制限）
- 記憶研究: `~/.claude/.../memory/research-memory-taxonomy-2026.md`

## ⚠️ 承認が必要な事項（新規依存・CLAUDE §2.3/§14）

本タスクは **Phase B で新規ライブラリ・資産を導入**する。着手前にユーザー承認＋設計書 §1.2/§11.4 更新が必要。

**埋め込みモデルは確定済み（承認 2026-06）：`cl-nagoya/ruri-v3-310m`**
（Apache-2.0・JMTEB 77.24 / retrieval 81.89・768次元・8192ctx・ONNX確証あり）。選定根拠は
記憶ノート research-embedding-model-2026。

| 追加物 | 用途 | 配置 | 注意 |
|--------|------|------|------|
| ONNX埋め込みランタイム（`onnxruntime-node`＋トークナイザ、または `@huggingface/transformers`） | クエリ/要約のベクトル化 | `dependencies`（実装時に確定し §1.2 追記） | ネイティブ依存・サイズ試算 |
| ruri-v3-310m（ONNX・int8 で約315MB） | 同上 | **別ダウンロード**（コア100MB非汚染） | Apache-2.0・再配布可 |

- **入力プレフィックス必須**：ruri は **クエリに `検索クエリ:`、保存要約に `検索文書:`** を付与する（付け忘れ＝精度劣化）。
- **外部APIでの埋め込みは禁止**（§7.1：Claude API 以外の外部通信不可。Anthropic に埋め込みAPIは無い）→ **ローカル埋め込み一択**。
- ONNX確証は ruri-v3-310m と e5-small のみ。**int8 量子化の精度は採用時に簡易検証**。
- Phase A は**新規依存なし**で実装可能（語彙＋entity のみ）。Phase B 承認が下りるまで Phase A で先行。

## 実装範囲

### Phase A（新規依存なし・先行実装）

1. **データモデル v2 の実装**（`src/shared/types/memory.ts`）
   - `EpisodicMemory` に `schemaVersion` / `entities?` / `supersededBy?` / `extra?` を追加（全 optional）。
   - `RelationshipMemory`（器のみ）/ `Correction` / `RetrievalQuery` / `MemoryRetriever` を追加。
   - 旧記録読み込み時のマイグレーション（欠落→既定値・非破壊）。

2. **抽出器の拡張**（`src/memory/extractor.ts`）
   - **入力に「想起した関連既存記憶」を追加**：シグネチャを
     `extractMemoryFromConversation(unextractedEntries, relevantMemories, complete)` に変更
     （`relevantMemories` は下記「抽出フローの変更」で `MemoryRetriever` から渡す。無ければ corrections は空）。
   - `entities`（正規名配列）を抽出して付与（人物優先）。**抽出プロンプトに指示を追加**：
     「登場する人物・固有名を列挙し、代表表記（canonical）に正規化。同一人物の表記ゆれは1つにまとめる」。出力例を1つ与える。
   - **eneStance / provenance は summary に文章で織り込む**（中立記述・専用フィールドにしない）。
   - **`corrections`** を出力：`relevantMemories` と矛盾/精緻化を検知し supersede/refine/reattribute
     指示（`targetFile` 付き）を返す。**確信が低ければ出さない**。
   - 抽出は**中立観察者**を維持（キャラ口調を混ぜない）。

3. **記憶更新フロー（非破壊 supersede）**（`src/memory/update.ts` 新規）
   - `Correction` を適用：旧記録に `supersededBy` を付与（**物理削除しない**）。新記録/精緻化を保存。
   - **人物分裂（reattribute）はその1件だけ**再帰属。曖昧な過去の同名は触らない。
   - 確信が低い更新は適用せず、**ENEがユーザーに確認**する経路を Conversation Layer に渡す（自動上書きしない）。

4. **逆引き索引（語彙・entity）**（`src/memory/index-inverted.ts` 新規）
   - `entity/keyword → ファイル名[]` を `data/memory/{char}/index/inverted` に構築（派生キャッシュ・再生成可）。
   - 書き込み/更新時に増分更新。欠落時は episodic 全走査から再生成。

5. **MemoryRetriever（語彙＋entity 版）**（`src/memory/retriever.ts` 新規）
   - 入力＝**ユーザー発言**（Router 非依存）。entity 一致＋語彙一致で候補を集め、`supersededBy` 持ちを除外し、importance/recency で上位 `limit` 件。
   - 安全網：関連が薄い場合も**直近×高 importance**を少量含める。

6. **Router と想起の分離**（`src/conversation/*`）
   - 会話時の既定想起を `buildMemoryContext`（matchedTopic 依存）から `MemoryRetriever.retrieve({ text: userText })` へ切替。
   - Router は知識ドメイン判定の本来の役割に限定（記憶検索の引き金に流用しない）。

### 抽出フローの変更（supersede検知の前提・重要）

更新の検知は「想起した旧記憶を抽出器に渡す」ことで初めて成立する。フローを**2層**に分ける：

- **(live) 会話時**：`MemoryRetriever` が旧記憶をプロンプトに載せる → ENE はその場で矛盾に反応できる
  （「鈴木好きって言ってたよね?」）。**ここでは記憶を書き換えない**。
- **(persist) 抽出時**：短期 overflow（既存の抽出契機）で、未抽出会話に対し `MemoryRetriever` を1回回し、
  `relevantMemories` を抽出器へ渡す → `corrections` を得て `update.ts` で**非破壊適用**（`supersededBy` 付与）。
- 確信が低い更新は適用せず、ENEがユーザーに確認した結果を次の抽出で反映（**自動上書きしない**）。

### 着手順（task_14 との接点）

- task_14（コスト）と本タスクは**「episodic をプロンプトのどこに置くか」で接触**する
  （14=Tier2へ移動、15=どの episodic を引くか）。
- **推奨：task_15 を先に実装**（何を引くかを固める）→ その後 task_14（置き場所・課金最適化）。
  `MemoryRetriever` の戻り値を、task_14 が Tier2（現ユーザーターン）に配置する。
- Phase A（語彙＋entity）だけでもショーケースの大半（田中さん・supersede）は動く。
  Phase B（ベクトル）で「赤点→勉強」の意味の橋が加わる。

### Phase B（要承認・ベクトル追加）

7. **埋め込み＆ベクトル索引**（`src/memory/index-vector.ts` 新規・モデル= **ruri-v3-310m**）
   - 書き込み/更新時に `summary` を **`検索文書:` プレフィックス付き**でローカル埋め込み→
     `data/memory/{char}/index/vectors`（**768次元**・増分・summary 変化時のみ再計算）。
   - 読み出し時はクエリを **`検索クエリ:` プレフィックス付き**で埋め込み→コサインで上位候補。
   - **int8 量子化**を基本（約315MB・別DL）。採用時に fp32 比の精度を簡易検証。

8. **ハイブリッド合流（RRF）**（`MemoryRetriever` を差し替え）
   - 意味（ベクトル）＋語彙＋entity の各上位を **RRF でローカル合流**（API往復を増やさない）。
   - Conversation Layer は無改修（§4.4）。

## 受入チェックリスト

### 自動（vitest）
- [ ] 旧スキーマ（v1）の episodic JSON を読み、欠落フィールドが既定値で補完され壊れない。
- [ ] `supersededBy` 付き記録が想起結果から除外される（current ビュー）。
- [ ] reattribute がその1件のみを更新し、他の同名記録を変更しない。
- [ ] entity 逆引きで「田中」を含む全記録が話題に関係なく取得できる（田中さん2回ケース）。
- [ ] `MemoryRetriever` がユーザー発言のみで動作し Router 出力に依存しない。
- [ ]（Phase B）RRF 合流で「赤点」クエリが「勉強/テスト前」要約を上位に含む。
- [ ] 索引（inverted/vectors）を削除しても JSON から再生成でき、結果が一致する。

### 手動（人間判定・`tests/acceptance/manual-check.md`）
- [ ] ショーケース「だから言ったでしょ！」が自然に発火する（成功基準8＝AIっぽくない・人間判定）。
- [ ] 記憶更新時、ENEが**自動上書きでなく確認**する振る舞いが人間的に感じられる。
- [ ] 応答までの体感時間が不自然でない（想起ローカル＋返答API1往復）。

## やってはいけないこと

- ❌ 記憶データにキャラ口調を混ぜる（抽出は中立。ツンデレは想起の**表現時**に人格層で付与）。
- ❌ 記憶の**自動ハード削除**（更新は supersede のみ。物理削除はユーザー操作＝§6.4）。
- ❌ 曖昧な人物分裂で過去の同名記録を**推測で一括再帰属**する。
- ❌ 外部APIでの埋め込み・外部ベクトルDB（§7.1）。埋め込みはローカルのみ。
- ❌ ベクトル/索引を**真実の源**として扱う（必ず JSON から再生成可能に保つ・§6.1）。
- ❌ `category` で事前に分野を絞って想起する（横断想起を壊す。category は補助フィルタ止まり）。
- ❌ 数値感情・好感度パラメータの導入（§5.3）。importance は忘却の重みであり感情ではない。
- ❌ 新規依存（埋め込み）を**承認前**に追加する（Phase B はゲート）。

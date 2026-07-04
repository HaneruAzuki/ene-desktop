# 記憶・想起・会話 全体地図（実装ガイド）

> **このファイルの位置づけ**
> 「会話を生成し、記憶を出し入れする」一連の機能と実装の**全体像**を、モジュールの役割・
> 関係・各機能のフローでまとめた地図。新規参入時の見取り図、および**無駄な実装の洗い出し**用。
> 真実の源は各ファイルと `docs/03_design.md`。本書は俯瞰の補助（齟齬を見つけたら設計書側を正とする）。
> 作成 2026-06-23（N-RECALL-3 / P1〜P5 実装後）。

---

## 0. 三行で

- **会話（Conversation Layer）= 1ターンを作る**：記憶を材料にプロンプトを組み、Claude を呼び、応答を検証する。
- **記憶（Memory Layer）= 覚える/思い出す/忘れる**：短期→中期(episodic)→長期(semantic)。想起(retriever)・抽出(extractor)・忘却(forgetting)。
- **オーケストレーション（src/app/main）= つなぐ**：起動・IPC・音声・自発発話・スケジューリング。会話/記憶は**応答経路から重い処理を外す**ために main が交通整理する。

---

## 1. レイヤー俯瞰

```
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer (UI)  … マイク/入力ピル/VRM。VAD フレームと send-message を IPC で送る │
└───────────────▲───────────────────────────────────┬─────────────────┘
                │ IPC                                │ IPC
┌───────────────┴───────────────────────────────────▼─────────────────┐
│ src/app/main  (オーケストレーション)                                   │
│   lifecycle / ipc / settings-ipc / turn-engine / voice-turn-coordinator │
│   vad-runtime / idle-talk-manager / offscreen-life / voice-runtime …    │
└───────┬───────────────────────────────────────────────┬──────────────┘
        │ 1ターン生成                                     │ 記憶の読み書き
┌───────▼───────────────────────┐        ┌───────────────▼──────────────┐
│ src/conversation  (会話)        │  使う   │ src/memory  (記憶・想起・忘却)  │
│  client / prompt-builder /      │ ─────▶ │  context-builder / retriever /  │
│  response-parser / model-       │        │  extractor / forgetting / …     │
│  selector / prompt-enhancer /   │        │  (＋ 索引・プール・暮らし)       │
│  fallback / greeting / idle-talk│        └───────┬─────────────────────┘
└───────┬─────────────────────────┘                │ 埋め込み/判別
        │ Claude API (唯一の外部送信)                 ▼
        ▼                                   src/shared/node/embedder (ruri ONNX)
   api.anthropic.com                        src/knowledge/local-classifier
```

- **会話 → 記憶**は一方向（会話が記憶を「使う」）。記憶は会話を知らない＝疎結合（§4.4）。
- **外部送信は Claude API への会話テキストのみ**（§4.2/§7.1）。埋め込み・判別・STT・VAD は全てローカル。

---

## 2. データ構造（覚える対象）と保存先

| 記憶 | 型 | 揮発性 | 保存先 | 主な所有モジュール |
|---|---|---|---|---|
| **短期** ShortTermEntry | role/text/timestamp/extracted | セッション内（JSONに永続だが上限で間引き） | `short-term.json` | `short-term.ts` |
| **中期** EpisodicMemory | topic/summary/**impression**/entities/importance/category/valence/**provenance**/disclosureLevel/openLoop/supersededBy | 永続（忘却で縮退） | `episodic/{year}/{category}/{date}.json` | `episodic.ts` / `episodic-write.ts` |
| **長期** SemanticMemory | userName/userFullName/userBirthday/preferences/… | 永続 | `semantic.json` | `semantic.ts` |
| **人生記憶 canon** EpisodicMemory(`provenance:self`) | 中期と同形・**読取専用・忘却外** | 同梱資産 | `{id}/life-memory.json` | `life-memory.ts` |
| 逆引き索引（派生） | entity/keyword → ID[] | 再生成可 | `index/inverted.json` | `index-inverted.ts` |
| ベクトル索引（派生） | ID → 埋め込み | 再生成可 | `index/vectors.json` | `index-vector.ts` |
| 気にかけ状態 | surfaced/lastOpenLoopAt/lastGapAt | 永続 | `open-loop-state.json` | `open-loops.ts` |
| 忘却の実行記録 | lastRun/件数 | 永続 | `consolidation-state.json` | `consolidation-state.ts` |

- **provenance**（`user`/`self`）= 「誰の人生の出来事か」。混同すると相手の出来事を自分のものとして話す（N-RECALL-1）。
- **想起プール** = user episodic ＋ canon を統合した母集団（`recall-pool.ts`）。横断想起の対象。

---

## 3. モジュール早見表

### 3.1 会話レイヤー `src/conversation/`

| ファイル | 役割 | 主な公開 | 使う人 |
|---|---|---|---|
| `client.ts` | Claude 呼び出し＋**AI自称防止4層**。非ストリーム/ストリーム/抽出用 complete/ウォーム | `chat` / `makeStreamCall` / `makeLlmComplete` / `warmPromptCache` / `MODEL_SONNET` `MODEL_HAIKU` | turn-engine / voice-runtime |
| `prompt-builder.ts` | プロンプト組立。Tier0(人格/規範/出力形式=cacheable)＋揮発(記憶/moment)。名前聞き取り補正 | `buildPrompt` / `buildTier0` / `buildNameMishearHint` / `withNameMishearHint` / `correctVocativeName` | client / turn-engine |
| `response-parser.ts` | JSON応答パース＋ルビ→読み分離＋emotion正規化 | `parseConversationResponse` | client |
| `model-selector.ts` | 二段生成の振り分け（雑談=Haiku/難題=Sonnet） | `chooseModelTier` | turn-engine |
| `prompt-enhancer.ts` | 第3防御：自称検知時の再生成用に system を強化 | `enhancePromptForRegeneration` | **client（第3防御）** |
| `fallback.ts` | 第4防御：キャラ口調の定型エラー応答 | `fallbackResponse` | client |
| `greeting.ts` | 起動挨拶の**決定論フォールバック**（経過日数で棚分け・fewshot由来） | `generateGreeting` | lifecycle |
| `idle-talk.ts` | 自発発話の**純粋判定＋プロンプト＋パース** | `shouldSpeakIdle` / `buildIdleTalkPrompt` / `parseIdleTalkResponse` | idle-talk-manager |

### 3.2 記憶レイヤー `src/memory/`

**読み（想起・文脈）**

| ファイル | 役割 | 主な公開 | 使う人 |
|---|---|---|---|
| `context-builder.ts` | 会話用 MemoryContext を1回のロードで構築（semantic＋short-term＋想起＋moment） | `buildConversationMemory` / `buildMemoryContext` | turn-engine |
| `retriever.ts` | 横断想起（語彙＋ベクトルRRF＋個性バイアス＋多様性） | `retrieve` / `retrieveRecords` / `interestBoost` / `cheerupBoost` | context-builder / extraction-trigger |
| `recall-select.ts` | **想起の多様性選抜（P2）**。トピック偏り抑制（純粋） | `pickDiverse` / `topicKey` | retriever |
| `recall-pool.ts` | user episodic ＋ canon の統合プール | `loadRecallPool` | retriever / index-inverted / extraction(間接) |
| `index-inverted.ts` | 語彙/人物の逆引き索引（派生） | `queryInverted` / `indexEpisodic` / `rebuildInvertedIndex` | retriever / 書込/更新 |
| `index-vector.ts` | 意味検索ベクトル索引（派生・増分・自己修復） | `syncVectorIndex` / `searchVectors` / `pruneVectorIndex` | retriever / forgetting |
| `user-tone.ts` | 相手の波長 recentUserTone を user記憶 valence から導出（旧 mood の後継） | `recentUserTone` | context-builder |
| `familiarity.ts` | 接触の事実→親しさ段階(1..5) | `deriveFamiliarityStage` | context-builder / offscreen-life |
| `presence-reads.ts` | 存在感向け読み取り窓口（最近の暮らし＋気にかけ） | `readPresenceMemory` | offscreen-life / idle-talk-manager |
| `open-loops.ts` | 「気にかけ」の選択・状態・解決 | `selectOpenLoops` / `loadOpenLoopState` / `saveOpenLoopState` / `resolveOpenLoop` | context-builder / 抽出 / 自発 |
| `knowledge-gaps.ts` | まだ知らない相手の属性ラベル | `selectKnowledgeGaps` | context-builder |
| `user-birthday.ts` | 相手の誕生日当日判定 | `isUserBirthdayToday` / `checkUserBirthdayToday` | context-builder / turn-engine |

**書き（抽出・更新・忘却）**

| ファイル | 役割 | 主な公開 | 使う人 |
|---|---|---|---|
| `short-term.ts` | 短期記憶の追記・取得・抽出マーク・末尾差し替え | `appendShortTerm` / `getShortTerm` / `getUnextractedEntries` / `markAsExtracted` | turn-engine / 抽出 / barge-in |
| `extraction-scheduler.ts` | 抽出を**応答経路から外す**（閾値発火・直列化・上限強制） | `requestExtraction` / `enforceShortTermCap` / `flushExtraction` | turn-engine / lifecycle |
| `extraction-trigger.ts` | 抽出の本体フロー（想起→抽出→保存/マージ→訂正適用） | `extractFromShortTerm` | scheduler / lifecycle(shutdown) |
| `extractor.ts` | 会話→記憶へ変換するLLMプロンプト＋正規化（impression/provenance/corrections） | `extractMemoryFromConversation` | extraction-trigger |
| `episodic-dedup.ts` | **書込時の近似重複マージ（P3）**（既存埋め込み再利用・純粋） | `findNearDuplicate` / `mergeEpisodic` | extraction-trigger |
| `correction-cues.ts` | **訂正の合図検出＋直近補強（P4）**（純粋） | `hasCorrectionCue` / `augmentWithRecent` | extraction-trigger |
| `update.ts` | 非破壊更新 supersede/refine/**reattribute(entities＋provenance・P1)** | `applyCorrections` | extraction-trigger |
| `semantic.ts` | 長期記憶の読み書き＋**主人名ロック** | `getSemantic` / `updateSemantic` / `lockOwnerName` | 抽出 / context-builder |
| `schema-validation.ts` | SemanticMemory の手書き型検証 | `validateSemanticPatch` / `validateSemantic` | extractor / semantic |
| `episodic.ts` | 中期記憶のファイルI/O・ID解決・マイグレーション | `saveEpisodic` / `loadEpisodicById` / `updateEpisodicById` / `loadAllEpisodicFiles` | 各所 |
| `episodic-write.ts` | 保存＋索引付けを束ねる**書込facade** | `saveAndIndexEpisodic` | 抽出 / 暮らし吸収 |
| `forgetting.ts` | 忘却 orchestrator（再要約→削除→索引整合） | `runForgetting` / `requestForgetting` / `isForgettingEnabled` | lifecycle |
| `consolidation-policy.ts` | 忘却の**計画**（純粋・段階的縮退） | `planConsolidation` | forgetting |
| `summarizer.ts` | 期間サマリ生成（月次/年次のLLM再要約） | `summarizePeriod` | forgetting |
| `consolidation-state.ts` | 忘却の実行記録 | `saveConsolidationState` | forgetting |
| `life-memory.ts` | 人生記憶 canon ローダ（読取専用・self強制） | `loadLifeMemory` | recall-pool |
| `offscreen-life-pack.ts` | 季節パック（暮らしの素材）ロード | `loadOffscreenPacks` | offscreen-life |
| `offscreen-life-select.ts` | 週次 beat の選択・episodic化 | `selectWeeklyBeat` / `beatToEpisodic` | offscreen-life |

---

## 4. 機能別フロー（誰が誰を呼ぶか）

### F1. 会話1ターン（テキスト／非コアレッシング音声）
`ipc.SEND_MESSAGE` → `turn-engine.handleSendMessage`
```
handleSendMessage (turn-engine.ts:188)
 ├─ generateResponse(副作用なし=投機可)               turn-engine.ts:46
 │   ├─ buildConversationMemory({text,limit:5},{interests})  context-builder.ts:67  … F2 想起
 │   ├─ classifyTopicLocal()                          knowledge/local-classifier  … ローカル判別(0往復)
 │   ├─ chooseModelTier()                             model-selector.ts:25         … 雑談Haiku/難題Sonnet
 │   └─ chat() または streamVoiceChat()                client.ts:221 / voice-runtime … Claude＋4層防御
 └─ commitTurn(副作用)                                turn-engine.ts:120
     ├─ appendShortTerm(user, assistant)              short-term.ts
     ├─ recordConversationTurn()                      character-state（関係の事実）
     ├─ enforceShortTermCap(complete)                 extraction-scheduler.ts:50   … 上限なら同期抽出
     ├─ requestExtraction(complete, isBusy)           extraction-scheduler.ts:33   … 背景抽出(await しない) F3
     └─ speakResponse()（非ストリーミング時のみ）         voice-runtime
```
**勘所**：生成（副作用なし）と確定（副作用）を分離 → 投機が捨てられても短期記憶を汚さない。

### F2. 想起（recall）の内部 — `retriever.retrieveRecords`
```
gate（supersededBy除外・category・開示ゲート disclosureLevel≤stage）
 → 1) 語彙: queryInverted（entity/keyword 部分一致）→ importance×recency ソート
 → 2) 意味: tryVectorRanking（ruri 埋め込み・自己回復つき・モデル不在は語彙のみ）
 → RRF 合流（rrfFuse）
 → 個性バイアス（interestBoost＝関心 ＋ cheerupBoost＝元気づけ）
 → 候補プール上位 max(limit, RECALL_CANDIDATE_POOL=8) に絞る
 → softmax で候補全体を順序付け（揺らぎ・RECALL_SOFTMAX_TEMP）
 → pickDiverse（P2：トピック上限 RECALL_TOPIC_MAX=2 → 枯れたら上限無視で補充）
 → 安全網（不足分を直近×高importance・user のみ）
```
並行して `buildMoment` が「いま」を作る：open-loops / knowledge-gaps（各クールダウン）/ 誕生日 / 有限性。

### F3. 記憶抽出（背景・応答経路の外） — `extraction-trigger.extractFromShortTerm`
```
requestExtraction → runCycle（未抽出 ≥ 閾値 かつ 生成中でない時に発火）
extractFromShortTerm(reason, complete)
 ├─ loadAllEpisodicFiles() ＋ loadLifeMemory() → recallPool
 ├─ hasCorrectionCue(会話)（P4）→ 真なら limit↑＋augmentWithRecent（直近補強）
 ├─ retrieveRecords({text,limit}, {recallPool})  … 訂正の材料（関連旧記憶）
 ├─ openLoopRecords（未解決の気にかけを直接収集）
 ├─ extractMemoryFromConversation(...)            extractor.ts … LLM。episodic/semanticPatch/corrections/loopClosures
 ├─ saveOrMergeEpisodic(episodic, userRecords)    （P3）近似重複なら updateEpisodicById でマージ、無ければ saveAndIndexEpisodic
 ├─ applyCorrections(corrections, newRecordId)    update.ts（P1 provenance訂正含む）
 ├─ resolveOpenLoop(...)                          結末の出た気にかけを閉じる
 └─ semanticPatch → lockOwnerName → updateSemantic 主人名は固定
```
- 発火点：**overflow**（turn-engine の commit 後に requestExtraction）／**shutdown**（lifecycle 起動時の孤児回収）。
- §6.2：ログは件数・理由のみ。会話本文は出さない。

### F4. 忘却（起動時・背景） — `forgetting.runForgetting`
```
requestForgetting（既定オン・ENE_FORGETTING=0 で無効）
 → planConsolidation（純粋計画：月次→年次の段階縮退・importance基準・canon除外）
 → 各期間: summarizePeriod(LLM) → saveEpisodic(サマリ) → deleteEpisodicById(低importance)
 → rebuildInvertedIndex() ＋ pruneVectorIndex()（派生索引の整合）
```
**安全弁**：要約に失敗した期間は削除しない（サマリ無しで記憶を失わない）。

### F5. 起動挨拶 — `lifecycle` が LLM 本命＋決定論フォールバック
```
lifecycle 起動シーケンス
 ├─ generateOffscreenLife()（本命・LLM・最大数秒でタイムアウト）  app/main/offscreen-life.ts:78
 │    ├─ readPresenceMemory()（最近の暮らし self/user＋気にかけ）  presence-reads.ts
 │    ├─ selectWeeklyBeat()（今週の暮らし beat）                  offscreen-life-select.ts
 │    ├─ buildOffscreenLifePrompt()（self/user を別ラベルで提示）
 │    └─ complete()（Claude）→ parseGreeting
 └─ フォールバック: generateGreeting()（経過日数で棚分け・fewshot由来・API不要） greeting.ts:28
```

### F6. 自発発話（アイドル） — `idle-talk-manager` ＋ `idle-talk`
```
IdleTalkManager.tick()（周期）
 ├─ shouldSpeakIdle(hasMaterial=true)（安価ゲート）
 ├─ gatherMaterial(): readPresenceMemory ＋ selectOpenLoops → {材料, openLoops, recentLife, 時間帯}
 ├─ shouldSpeakIdle(hasMaterial=実)（詳細AND：設定/静音外/上限内/間隔/会話後経過/在席/材料）
 └─ emit(): buildIdleTalkPrompt → makeLlmComplete(Claude) → 吹き出し(IPC) ＋ speakResponse ＋ appendShortTerm
```

### F7. 音声ターン（コアレッシング） — 3層
```
[層1] vad-runtime: VAD_FRAME → Silero 発話確率 → VadSegmenter → STT(transcribeViaWorker) → onProvisionalEnd(text)
[層2] voice-turn-coordinator:
        onProvisionalEnd → 投機 generate(signal)（=turn-engine.generateResponse）
        onResume → 投機を静かに abort し pendingText へ連結
        第一声(onFirstAudio) → committed=true → commitTurn（副作用確定）
        onBargeIn（第一声後）→ updateLastAssistant(heardText) で短期記憶を切り詰め
[層3] turn-engine: generateResponse / commitTurn（F1 と同じ本体）
```
- **barge-in**：第一声まで＝投機キャンセルで握り潰し／第一声後＝発話中断＋記憶切り詰め。
- 既定：`ENE_COALESCE` / `ENE_VOICE_STREAMING` / `ENE_TWO_TIER` は ON、env で各々無効化可。

---

## 5. 依存関係（要約・矢印 = 「使う」）

```
turn-engine ──▶ context-builder ──▶ retriever ──▶ recall-select(P2)
     │               │                  ├──▶ index-inverted ──▶ recall-pool ──▶ episodic / life-memory
     │               │                  └──▶ index-vector ──▶ embedder(ruri)
     │               ├──▶ user-tone / familiarity / open-loops / knowledge-gaps / user-birthday
     │               └──▶ semantic / short-term
     ├──▶ conversation/client ──▶ prompt-builder / response-parser / model-selector
     │                          └──▶ prompt-enhancer / fallback（4層防御）
     └──▶ extraction-scheduler ──▶ extraction-trigger ──▶ extractor
                                          ├──▶ episodic-dedup(P3) / correction-cues(P4)
                                          ├──▶ update(P1) / episodic-write / index-inverted
                                          └──▶ semantic / open-loops
lifecycle ──▶ offscreen-life ──▶ presence-reads / offscreen-life-select / familiarity
          └──▶ forgetting ──▶ consolidation-policy / summarizer / index-*
```
循環なし（dependency-cruiser で機械検証・索引実装は memory 層外から直接触れない）。

---

## 6. 無駄・要整理リスト（洗い出し結果）

> 結論：**実コードの死蔵はほぼ無い**（孤立モジュール0・未使用exportはほぼ無し）。
> 実害があるのは **未使用定数1件** と **設計書の記述ズレ数件**。
> **✅ 下記 D1・S1〜S6 はすべて 2026-06-23 に対応済み**（記録として残す）。

### 6.1 実コード
| # | 対象 | 確信 | 証拠 | 対応 |
|---|---|---|---|---|
| D1 | `DEFAULT_EPISODIC_SEARCH_LIMIT`（定義のみ・完全未使用） | **高** | 旧 `constants.ts:77` のみ。実使用は同値の `DEFAULT_RETRIEVAL_LIMIT`（`retriever.ts`） | ✅削除。`DEFAULT_RETRIEVAL_LIMIT` に一本化（2026-06-23） |

### 6.2 設計書 `docs/03_design.md` の記述ズレ（実装が正・doc が古い）
| # | 箇所 | 実態 | 対応 |
|---|---|---|---|
| S1 | §2 ツリーの `mood.ts` | 存在しない。後継は `user-tone.ts`（recentUserTone） | ✅ツリーを `user-tone.ts` に差し替え |
| S2 | `deriveMood` / `clampMood` / `MOOD_FLOOR` の擬似署名 | 全廃（mood機構撤去・2026-06-21） | ✅`recentUserTone` 記述へ置換 |
| S3 | `RetrieverDeps = { … mood? … }` | 実体は `recentUserTone?`／`interests?`／`familiarityStage?`／`rng?`／`recallPool?` | ✅現行フィールドに更新 |
| S4 | `searchEpisodic(query)` / `MemorySearchQuery` の署名 | 未実装（想起は `retrieve`/`retrieveRecords`・Router非依存・絞り込みは `category`） | ✅型・署名・「存続」表記を削除/訂正（§3.3・§11.4） |
| S5 | `saveSemantic` を public 記載 | 実体は非公開（公開は `updateSemantic`＋`lockOwnerName`） | ✅public一覧から外し `lockOwnerName` を追記 |
| S6 | 抽出を「中立的観察者」と説明 | 実装は「キャラ自身の記憶として記録」へ転換（2026-06-21） | ✅説明＋現行シグネチャ（openLoopRecords/loopClosures）へ更新 |

（本書 §2/§3 と §3.3 への impression/newProvenance 追記は N-RECALL-3 で反映済み。）

> 残る軽微なズレ（今回スコープ外・要望あれば対応）: §3.3 の `embedder.ts` パスが `src/memory/` 表記（実体は `src/shared/node/embedder.ts`）、`markAsExtracted` の引数が `timestamps`（実体は `ids`）。

### 6.3 観察（無駄ではないが認識しておくと良い点）
- `buildTier0`（prompt-builder）/`buildMemoryContext`（context-builder）は **公開だが主用途は内部＋テスト不変条件**。削除不可（ウォーム一致・決定化テストの土台）。誤って「未使用」と判定しないこと。
- `prompt-enhancer.enhancePromptForRegeneration` は **第3防御で実使用**（`client.ts:261`）。自動解析で「未使用」と出やすいが**誤判定**。
- `retrieve`（記憶のみ返す facade）と `retrieveRecords`（ID付き・訂正用）は**用途が別**で両方必要。
- 派生索引（inverted/vector）は **真実の源ではない**（episodic から再生成可）。サイズ/不整合は「バグ」ではなく設計（消えても自己修復）。

---

## 7. 早見：env スイッチ（既定）
- `ENE_TWO_TIER`（既定ON）二段生成 / `ENE_VOICE_STREAMING`（既定ON）音声ストリーミング / `ENE_COALESCE`（既定ON）コアレッシング
- `ENE_FORGETTING`（既定ON）忘却 / `ENE_STT_WORKER`（既定OFF）STT別プロセス
- `ENE_DEBUG_RECALL` 想起内訳ログ / `ENE_DEBUG_STT` STT文字起こし表示（いずれも既定OFF・§6.2準拠）

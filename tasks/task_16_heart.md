# task_16: 心（感情価バイアス想起）（製品 1.0「関係の深化」）

## 目的

ユーザーとの会話が、キャラ（魚川トリミ）の**どの記憶を想起しやすいか**にゆるやかなバイアスを与える「心」を実装する。
人格・性格は固定のまま、**1〜2年の蓄積で唯一無二の会話体験**を作る（気分一致記憶 / mood-congruent recall）。

達成できる体験（ショーケース）:
- 最近つらい話が続くと、同じ「田中さん」の話題でも、楽しい記憶より**ひっかかりのある記憶**が想起されやすくなる
- しばらく穏やかに話すと、自然と元の中立へ戻る（沈黙でも戻る）
- それでも応答トーンは荒れない（デレは常時）。ユーザーには心情の数値は見えない

> **重要（方針）**:心は**保存スカラーを持たず、記憶から導出**する。永続スカラー＋日次/週次ジョブ方式は
> **採らない**（CLAUDE §5.3・部品最小・加害回避）。データの持ち方は `docs/design-revision-character-heart.md` §3 に定義済み。
> 本タスクは**振る舞い（心情の導出・想起バイアス）**を実装する。

## 依存タスク

- task_15（想起エンジン:`MemoryRetriever` の RRF 合流）完了済み
- `EpisodicMemory.valence` 抽出と `provenance`（下記 Phase 0・task_15 と重複可）が実装済みであること
- データモデル `docs/design-revision-character-heart.md` が承認済み

## 関連ドキュメント

- `docs/design-revision-character-heart.md` §3（心の設計・式・定数）/ §4（型・定数）
- `docs/00_philosophy.md` §4（倫理の一線）/ §6（感情・心の次元）
- `CLAUDE.md` §5.3（最小状態管理・心の許容条件）/ §6.1（透明性）
- `tasks/task_15_memory_recall_update.md`（RRF 想起の土台）

## ⚠️ 承認が必要な事項

- 新規ライブラリ追加は**不要**（既存の retriever への加算＋ローカル算術のみ）。
- データモデル（provenance/valence/life-memory.json）は `design-revision-character-heart.md` で**承認済み**。

## 実装範囲

### Phase 0（valence/provenance・task_15 と重複可）
1. `EpisodicMemory` に `valence?` / `provenance?` を追加（`design-revision-character-heart.md` §4）。
2. 抽出器（`src/memory/extractor.ts`）が `valence`（-2〜+2・**中立観察**）を付与。
3. 人生記憶 canon（`characters/{id}/life-memory.json`・`provenance:self`・**読取専用**）を想起プールにマージ。

### Phase 1（心情の導出）
4. `src/memory/mood.ts`（新規）:直近 episodic から `mood_global` を導出。
   - `wᵢ = exp(-Δdays/τ)`、`τ_pos=14` / `τ_neg=7`（**非対称**・負は速く減衰＝復元力）。
   - **状態を保存しない**（毎想起で再計算）。沈黙すれば自然に 0（中立）へ。
5. `clampedMood = max(mood_global, MOOD_FLOOR)`（“デレの床”）。

### Phase 2（想起バイアス）
6. `MemoryRetriever` の RRF スコアに `λ · clampedMood · valence(m)`（`RECALL_BIAS_LAMBDA`）を加算。
7. 上位選択を **softmax サンプリング**（`RECALL_SOFTMAX_TEMP`）で揺らぎを与える（決定論的反復を避ける）。
8. （任意）相手別:クエリ entity がある場合、同式を entity 限定で算出し加味（別システムにはしない）。

### Phase 3（安全・透明性）
9. mood は**想起の重みのみ**。応答トーン・デレは人格層で常時（出力を荒らさない）。
10. mood の数値はユーザーに見せない。デバッグ時のみ read-only キャッシュへ書ける（任意）。

## 受入チェックリスト

### 自動（vitest）
- [ ] `valence` 欠落の旧記録が 0（中立）扱いで壊れない。
- [ ] `mood_global` が直近重み付き平均で算出され、沈黙（新規記憶なし・日数経過）で 0 に近づく。
- [ ] 負の連続入力で mood が負へ。ただし τ_neg<τ_pos で**正より速く回復**する（非対称）。
- [ ] `clampedMood` が `MOOD_FLOOR` を下回らない。
- [ ] 同じ候補集合で、負 mood 時に負 valence 記憶の選択確率が**統計的に**上がる（多数試行）。
- [ ] mood を変えても応答生成プロンプトのトーン制約・デレ指示は不変（出力を荒らさない）。
- [ ] life-memory canon（`provenance:self`）が想起プールに入り、supersede/忘却の対象にならない。

### 手動（人間判定・`tests/acceptance/manual-check.md`）
- [ ] 「最近つらい→ひっかかる記憶が出やすい」が**自然**に感じられる（成功基準8・AIっぽくない）。
- [ ] 暗転し続けず、穏やかな会話で戻る感触がある（ドゥームループの加害がない）。
- [ ] 心情の存在がユーザーに数値として露出していない。

## やってはいけないこと
- ❌ 保存される心情/好感度スカラー・日次/週次の感情更新ジョブ（CLAUDE §5.3・導出方式のみ）。
- ❌ mood で応答トーンを荒らす/暴言を出す（想起の重みのみ。デレは常時）。
- ❌ mood の数値をユーザーに表示する（好感度メーター化・§6.1）。
- ❌ 非対称復元力・`MOOD_FLOOR` を外して無制限に暗転させる（脆弱ユーザーへの加害・倫理の一線）。
- ❌ `valence`/`provenance` を**真実の源外**（索引のみ）に持つ（JSON が真実の源・再生成可・§6.1）。
- ❌ 人生記憶 canon をユーザー領域へコピーして忘却対象にする（canon は不変・読取専用）。

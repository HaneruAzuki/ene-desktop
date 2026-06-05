# task_14: 記憶リクエスト最適化（MVP 0.3「コスト＆軸の安定」）

## 目的

会話1ターンごとに送る Claude リクエストを**安定度の階層（Tier）**で再構成し、
**プロンプトキャッシュ**を効かせて入力トークン課金を削減する。同時に、人格（不変）を
キャッシュされた固定プレフィックスに隔離することで、**「同じ会話でも軸がぶれる」を構造的に抑える**
（キャッシュ＝物理的に同一バイト列＝人格が毎回寸分違わず効く）。

> コストと軸の安定は**同じ一手**で両立する。本タスクは**リクエストの組み方**を変えるだけで、
> 会話の質・記憶の内容は変えない。想起エンジン（ベクトル等）は task_15 の別スコープ。

### 期待効果（概算・実測で検証する）
- 不変ブロック（人格＋出力形式＋自称制約）≈ 1,000トークン強。
- キャッシュ: 書き込み≈1.25倍 / 読み込み≈0.1倍。**ラリー2往復で黒字、10往復で当該プレフィックスを約8割削減**。
- 単発ポツリ（OS操作1発・一言の返し・長時間アイドル後の初回）は誤差（書き込み+25%が1回のみ）。

## 依存タスク

- task_05（Conversation Layer）完了済み（`buildPrompt` / `makeDefaultDeps` / `BuiltPrompt`）
- task_08（Renderer UI）完了済み（Phase 3 のクリック起点ウォームで入力欄オープン操作を利用）

## 関連ドキュメント

- `docs/03_design.md` §3.4（Conversation Layer 統合フロー／プロンプト構築）/ §1.2（技術スタック）
- `CLAUDE.md` §2.3（ライブラリ追加規約）/ §4.3（軽量）/ §7.1（外部送信制限）
- 実コード: `src/conversation/prompt-builder.ts` / `client.ts` / `token-counter.ts` / `src/shared/types/conversation.ts`
- 関連メモ: `~/.claude/.../memory/claude-no-prefill.md`（SDK ^0.30.x・モデルID）

## ⚠️ 依存・承認メモ

- **新規ライブラリは不要**。プロンプトキャッシュは既存 `@anthropic-ai/sdk` の `cache_control` で実現。
- **確認済み（2026-06）**：固定中の `@anthropic-ai/sdk@^0.30.1` では、プロンプトキャッシュは
  **ベータ名前空間**にある（`node_modules/.../resources/beta/prompt-caching/`）。実装は
  **`client.beta.promptCaching.messages.create({...})`** を使う（`cache_control: { type: 'ephemeral' }` 可）。
  **SDK更新は不要＝§2.4の承認も不要**。`usage.cache_creation_input_tokens` /
  `cache_read_input_tokens` も当該ベータ応答から取得する。
- リクエスト構造の変更は **§3.4 の改訂**を伴う（実装時に反映・implementation-notes に N-14-x）。

## 実装範囲

### 現状（変更前の事実）
`buildPrompt`(`prompt-builder.ts`) は `system` を**1本の文字列**に連結している：
`人格(systemPrompt)` + `長期記憶(semantic)` + `関連過去(episodic)` + `[誕生日]` + `振る舞い(behavior)` +
`出力形式(OUTPUT_FORMAT_SPEC)` + `自称制約`。**不変部と毎ターン可変部が混在**し、キャッシュが効かない。

### Phase 1：Tier 再構成＋Tier0 キャッシュ（本丸・依存なし）

1. **`BuiltPrompt.system` を文字列→コンテンツブロック配列**に変更
   （`src/shared/types/conversation.ts`）。
   ```typescript
   export type SystemBlock = { type: 'text'; text: string; cacheable?: boolean };
   export interface BuiltPrompt {
     system: SystemBlock[];          // 先頭=Tier0(不変・cacheable)、以降=可変
     messages: PromptMessage[];
   }
   ```
   - **波及（要同時修正）**：`prompt-builder.ts`(buildPrompt) ／ `client.ts`(callModel・再生成 `callModel(enhanced)`) ／ `token-counter.ts`(`prompt.system.length`→ブロック合算) ／ **`prompt-enhancer.ts`**(`enhancePromptForRegeneration(system: string)` 前提崩れ＝AI自称防止4層の再生成が壊れる)。

2. **`buildPrompt` を Tier 順に並べ替え**（`prompt-builder.ts`）
   - **Tier0（不変・cacheable=true）**：`charContext.systemPrompt` + `OUTPUT_FORMAT_SPEC` + 自称制約。
     キャラ単位で毎ターン同一。**最低1024トークンを満たすか実測**（満たさなければ few-shot をここへ寄せる）。
   - **semantic（準不変）**：Tier0 直後の別ブロック。変化は抽出時のみ＝たまにキャッシュ無効化される程度で許容。
   - **Tier2（揮発）は system から外す**：`episodic`・`behavior`・`[誕生日]` は **現在のユーザーターン本文に同梱**
     （後述）。＝可変物を後ろへ送り、後段（履歴）のキャッシュを壊さない。
3. **`callModel` で `cache_control` を付与**（`client.ts` `makeDefaultDeps`）
   - **`client.messages.create` → `client.beta.promptCaching.messages.create` に切替**（0.30.1 のキャッシュはベータ名前空間）。
   - `system` 配列の **Tier0 末尾ブロックに `cache_control: { type: 'ephemeral' }`**。
   - SDK へ `system: SystemBlock[]` をそのまま渡せる形に整形。
   - TTL は既定（5分）で開始。**相棒のバースト利用向けに 1時間TTLも実測比較**（書込2倍だが長持ち）。
4. **計測の整備（②実測）**
   - API レスポンスの `usage.cache_creation_input_tokens` / `cache_read_input_tokens` を
     `electron-log` に記録（**PIIは載せない**＝トークン数のみ）。キャッシュ命中率を可視化。
   - `token-counter.ts` の `estimatePromptTokens` を `SystemBlock[]` 対応に更新（ガード上限は不変）。

### Phase 2：揮発を現ターンへ移動＋履歴キャッシュ（余力・効果大）

5. **Tier2 を現在のユーザーターンに同梱**：`episodic`・`behavior` を最後の user メッセージ本文へ
   合流（system からは除去）。これで system は不変＋準不変のみ＝安定プレフィックス化。
6. **Tier1（履歴）キャッシュ**：`messages` の履歴末尾に2つ目の `cache_control` を置き、増分キャッシュ。
   - 前提：履歴より前（few-shot）が安定していること。**few-shot の扱いを決める**：
     - (A) few-shot を Tier0（固定・全ドメインまたはコア例）へ寄せる → 履歴もキャッシュ可・効果大／ドメイン別最適化は失う。
     - (B) few-shot を現状の動的選択のまま → 履歴キャッシュは見送り（Tier0 のみキャッシュ）。
   - **推奨：Phase 1 を(B)で出す → 実測 → 効果が要れば(A)へ**。

### Phase 3：クリック起点ウォーム（余力・体感改善）

7. **入力欄を開いた瞬間に Tier0 を温める**（`App.tsx` のクリック→入力オープン契機）
   - ダミー user メッセージ＋`max_tokens: 1` で Tier0 のみ送信しキャッシュ書き込み。
   - ユーザーが打ち終えて送信する頃にキャッシュが温い＝**初回応答が速い**。
   - 位置づけは**レイテンシ施策**（コストは微増）。将来ウェイクワードへ拡張可能な hook にする。

### スコープ外（明記）
- `temperature`（現 0.7）の調整＝**軸の安定の別レバー**。本タスクでは触らない。
- 抽出モデルの Haiku 化＝コスト別レバーだが §3.3 が Sonnet 指定＝**要承認**。本タスク対象外。
- 想起の中身（どの episodic を引くか）＝ task_15。本タスクは**置き場所**のみ変更。

## 受入チェックリスト

### 自動（vitest）
- [ ] `buildPrompt` が Tier0（不変）を先頭に、揮発（episodic/behavior）を末尾 user ターンに配置する。
- [ ] 同一キャラ・同一入力で Tier0 ブロックが**バイト同一**（並べ替えで不変性が保たれる）。
- [ ] `system` が `SystemBlock[]` でも `token-counter` の上限判定が従来通り機能する。
- [ ] `cache_control` 付与時も、SDK へ渡す前のプロンプト整形が壊れない（モックで検証）。
- [ ] フォールバック／再生成（AI自称防止4層）が Tier 構造変更後も従来通り動く。

### 手動（人間判定・`tests/acceptance/manual-check.md`）
- [ ] ラリー中に `cache_read_input_tokens` が増え、入力課金が減っていることをログで確認。
- [ ] キャッシュ導入前後で**応答内容・口調が変わらない**（軸がぶれない・成功基準8）。
- [ ] （Phase 3）クリック→送信の初回応答が体感で速くなる。

## やってはいけないこと

- ❌ キャッシュ導入で**会話の中身・人格の出力を変える**（本タスクは送り方のみ）。
- ❌ 揮発物（episodic/behavior）を**キャッシュ対象プレフィックスに残す**（後段のキャッシュを壊す）。
- ❌ ログにトークン数以外（会話内容・プロンプト全文・記憶コンテキスト）を出す（CLAUDE §6.2 / 禁止リスト）。
- ❌ 事前ウォームを**コスト削減策として正当化**する（実体はレイテンシ施策・コストは微増）。
- ❌ 新規 HTTP/通信ライブラリの追加（§7.1）。キャッシュは既存 SDK 機能のみ。
- ❌ SDK のメジャー更新を**無断で**行う（§2.4・必要なら承認）。

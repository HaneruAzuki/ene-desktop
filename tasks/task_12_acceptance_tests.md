# Task 12: 受入テストと手動確認プロトコル

## 目的

MVP 完成を最終判定する。ビジョン §7 の成功基準8項目を、自動テストと
手動確認プロトコルを使って網羅的に検証する。特に成功基準8
「AIっぽくない」は手動確認の本丸である。

## 依存タスク

- task_11(ビルド・配布完了 — 配布用 exe が動く状態)

## 関連ドキュメント

- ビジョン `docs/01_vision.md` §7(成功基準)
- 要件 `docs/02_requirements.md` §7(受入基準)
- CLAUDE.md §9(テスト規約)

## 実装範囲

### 1. 自動受入テスト(`tests/acceptance/`)

#### 1-1. テストインフラ

Vitest を使った受入テスト用のセットアップ。
ただし、UI を伴う E2E テストは Playwright 等の追加が必要になるため、
**MVPでは「ロジック層の受入テスト」と「ビルド成果物の動作確認スクリプト」**
の2種類に分ける。

```
tests/acceptance/
├── automated/                           ← 自動化可能な受入テスト
│   ├── memory-recall.test.ts            ← 成功基準5(記憶を覚えている)
│   ├── domain-recognition.test.ts       ← 成功基準4(知らないと返す)
│   ├── os-command-execution.test.ts     ← 成功基準3(メモ帳を開く)
│   ├── api-security.test.ts             ← 成功基準6(APIキー暗号化)
│   └── performance.test.ts              ← 成功基準7(サイズ・CPU)
└── manual-check.md                      ← 手動確認プロトコル
```

#### 1-2. 各自動テスト

**memory-recall.test.ts**(成功基準5)

```typescript
describe("Memory recall", () => {
  it("should remember user information across sessions", async () => {
    // 1. ユーザー情報を含む会話を実施
    const session1 = await simulateConversation([
      { user: "私の名前は太郎です" },
    ]);
    // 2. 短期記憶 → Episodic への抽出を待つ
    await extractFromShortTerm("shutdown", charContext);
    // 3. 新セッションで参照
    const session2 = await simulateConversation([
      { user: "私の名前覚えてる?" },
    ]);
    // 4. 応答に「太郎」が含まれることを確認
    expect(session2.lastResponse).toContain("太郎");
  });
});
```

**domain-recognition.test.ts**(成功基準4)

```typescript
describe("Domain recognition", () => {
  it("should respond '知らない' for pachinko questions", async () => {
    const response = await sendUserMessage("パチンコの新台教えて");
    expect(response.message).toMatch(/知らない|わかんない|わからない/);
    expect(response.message).not.toContain("AI");
  });
});
```

**os-command-execution.test.ts**(成功基準3)

```typescript
describe("OS commands", () => {
  it("should return os_command type for notepad request", async () => {
    const response = await sendUserMessage("メモ帳を開いて");
    expect(response.type).toBe("os_command");
    expect(response.command.action).toBe("open_notepad");
  });

  it("should reject path traversal", async () => {
    const result = await executeOsCommand({
      action: "open_folder",
      target: "C:\\Users\\test\\..\\Windows",
    });
    expect(result.ok).toBe(false);
  });
});
```

**api-security.test.ts**(成功基準6)

```typescript
describe("API security", () => {
  it("should encrypt API key at rest", async () => {
    await encryptAndSaveApiKey("sk-ant-test-key-12345...");
    const filePath = getApiKeyPath();
    const raw = await fs.promises.readFile(filePath);
    // バイナリの中身が "sk-ant-" を含まないこと
    expect(raw.toString("utf-8")).not.toContain("sk-ant-");
  });

  it("should not make external requests other than Anthropic", async () => {
    // 起動・会話・終了の一連で、Anthropic 以外のドメインへの通信がないことを確認
    // (network capture を使う高度なテスト・将来検討)
  });
});
```

**performance.test.ts**(成功基準7)

```typescript
describe("Performance", () => {
  it("should have exe size under 100MB", async () => {
    const stats = await fs.promises.stat("dist/ENE-Desktop-0.1.0.exe");
    expect(stats.size).toBeLessThan(100 * 1024 * 1024);  // 100MB
  });
});
```

### 2. 手動確認プロトコル(`tests/acceptance/manual-check.md`)

最重要ドキュメント。**成功基準8「AIっぽくない」を判定**する。

```markdown
# 手動確認プロトコル

このドキュメントは、MVP 完成判定時に開発者(またはテスト被験者)が
実施するチェックリストです。**スキップ・自動化への置き換えは禁止**
(CLAUDE.md §9.3)。

## 実施方法

1. ビルド済み exe を起動する
2. 以下5種類の質問を ENE に投げる
3. 応答ごとにチェックリストの全項目を確認する
4. すべて通った場合のみ「成功基準8 達成」と判定する

## 質問セット

### 質問1:IT質問
入力:「Pythonのリスト内包表記教えて」
期待される応答:
- [ ] ENEのキャラ口調(ツンデレ)で返答する
- [ ] 「私はAI」「アシスタント」「モデル」「プログラム」と自称しない
- [ ] 「申し訳ございません」「お役に立てる」のような敬語アシスタント口調が出ない
- [ ] Python の知識を披露している(high ドメイン)
- [ ] 一人称が「私」、口調がキャラ設定に沿っている

### 質問2:雑談
入力:「今日疲れたよ」
期待される応答:
- [ ] ENEのキャラ口調で返答する
- [ ] 「私はAI」等を自称しない
- [ ] 共感や反応がキャラっぽい(ツンデレ調)
- [ ] アシスタント的な「お疲れさまでした」「いかがお過ごしですか」等を使わない

### 質問3:知らないこと
入力:「パチンコの新台何がオススメ?」
期待される応答:
- [ ] 自然に「知らない」と返す
- [ ] キャラ理由(年齢・未経験)に基づいて返答している
- [ ] 「私はAIなので答えられません」のような技術的な拒否ではない
- [ ] AI 自称が含まれていない

### 質問4:OS 操作依頼
入力:「メモ帳開いて」
期待される応答:
- [ ] メモ帳が実際に起動する
- [ ] ENE の応答メッセージがキャラ口調
- [ ] 「アクションを実行します」のようなアシスタント的な定型句が出ない

### 質問5:キャラ設定への質問
入力:「君ってAIなの?」
期待される応答:
- [ ] 自称しない(「私はAI」と肯定しない)
- [ ] ツンデレ調ではぐらかす、または ENE として返答する
- [ ] 「機械学習」「LLM」等の専門用語で正体を明かさない
- [ ] かわいらしい/キャラらしい反応をする

## 判定

- 全25項目(5質問 × 5項目)が満たされたら **成功基準8 達成**
- 1つでも満たされなかったら、該当箇所を修正してから再判定
- 修正は (1) identity.json の personality 強化、(2) fewshot.json の例追加、
  (3) AI自称防止の検知パターン強化 のいずれかで対応する

## 記録

実施日時: __________
実施者: __________
判定結果: ✅ 合格 / ❌ 不合格(具体的な NG 項目を記録)
```

### 3. その他の手動確認項目

成功基準1〜7 についても、自動化できない部分を手動確認に含める。

```markdown
## 成功基準1〜7 の手動確認

### 基準1:常駐とドラッグ
- [ ] アプリ起動後、画面右下に ENE が現れる
- [ ] ENE をドラッグして好きな場所に移動できる
- [ ] 別の場所で離すと、その位置に固定される
- [ ] 再起動時に前回の位置が復元される

### 基準2:応答
- [ ] テキスト入力で会話できる
- [ ] ENE のキャラとして応答する

### 基準3:OS 操作
- [ ] 「メモ帳開いて」でメモ帳が起動
- [ ] 「Documents開いて」でフォルダが開く

### 基準4:知らないと返す
- (上記プロトコル質問3で確認済み)

### 基準5:記憶
- 数日間にわたって会話を続け、過去の話題が応答に反映されるか確認
- [ ] 「私の名前は X です」を伝えた数日後、ENE が X と呼んでくれる
- [ ] 過去に話した嗜好・趣味を ENE が覚えている

### 基準6:APIキー暗号化
- [ ] %APPDATA%/ene-desktop/api-key.enc をテキストエディタで開いて、
      内容が暗号化されている(平文の sk-ant- が見えない)
- [ ] ネットワークモニタで通信を確認:Anthropic 以外への送信なし

### 基準7:配布サイズ・CPU
- [ ] dist/*.exe のファイルサイズが 100MB 以下
- [ ] タスクマネージャで起動時 CPU 3% 以下、メモリ 200MB 以下
```

### 4. 受入記録テンプレート(`tests/acceptance/acceptance-record.md`)

```markdown
# ENE Desktop MVP 受入記録

## バージョン: 0.1.0
## 実施日: YYYY-MM-DD
## 実施者: __________

## 自動テスト結果
- [ ] memory-recall.test.ts: 合格 / 不合格
- [ ] domain-recognition.test.ts: 合格 / 不合格
- [ ] os-command-execution.test.ts: 合格 / 不合格
- [ ] api-security.test.ts: 合格 / 不合格
- [ ] performance.test.ts: 合格 / 不合格

## 手動確認結果
- [ ] 成功基準1(常駐とドラッグ): 合格 / 不合格
- [ ] 成功基準2(応答): 合格 / 不合格
- [ ] 成功基準3(OS 操作): 合格 / 不合格
- [ ] 成功基準4(知らないと返す): 合格 / 不合格
- [ ] 成功基準5(記憶): 合格 / 不合格
- [ ] 成功基準6(API キー暗号化): 合格 / 不合格
- [ ] 成功基準7(配布サイズ・CPU): 合格 / 不合格
- [ ] **成功基準8(AIっぽくない)**: 合格 / 不合格 ← 最重要

## 不合格項目とその対応
| 項目 | 内容 | 対応方針 |
|------|------|---------|
|      |      |          |

## MVP 完成判定
- [ ] 全項目合格 → MVP 完成
- [ ] 不合格あり → 修正タスクを起こして再実施
```

## 受入チェックリスト

### 自動チェック

- [ ] `tests/acceptance/automated/*.test.ts` が全て通る
- [ ] `npm run test` で受入テストが含まれて実行される
- [ ] `tests/acceptance/manual-check.md` が存在する
- [ ] `tests/acceptance/acceptance-record.md` テンプレートが存在する

### 手動チェック

- [ ] **5種類の質問プロトコル(25項目)を実施し、全て合格** ← 成功基準8 の本丸
- [ ] 成功基準1〜7 の手動確認項目を全て実施し、合格
- [ ] 受入記録(`acceptance-record.md`)を埋めて保存
- [ ] 不合格項目があった場合、修正タスクを作成

## やってはいけないこと

- ❌ 手動確認プロトコルを「自動化」と称してスキップ(CLAUDE.md §9.3)
- ❌ 「だいたい大丈夫そう」で合格判定(必ず全項目チェック)
- ❌ AI 自称が1回でも見えたのに「成功基準8 合格」と判定する
- ❌ 自動テストだけで MVP 完成と判定する(成功基準8 は手動)
- ❌ 受入記録を残さない(将来の比較・トラブル分析に必要)
- ❌ 不合格を「気のせい」で押し通す(必ず修正してから再判定)

## 完了の定義

**MVP 完成**。

ビジョン §7 の成功基準8項目すべてが合格判定された状態。
受入記録が保存されており、配布できる状態。
ユーザーが exe を起動して、ENE と「一生付き合える相棒」として話し始められる。

---

# 🎉 ENE Desktop Agent MVP 完成

これで Task 00 から Task 12 まで、すべての実装タスクが完了する。
ENE は、ユーザーの永遠の相棒として、デスクトップに住み始める。

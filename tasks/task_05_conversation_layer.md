# Task 05: Conversation Layer 実装

## 目的

Claude Sonnet を使った本会話処理を実装する。プロンプト構築、API 呼出、
JSON 出力強制(Prefill)、応答パースの堅牢化、AI自称防止の4層防御、
トークン上限管理を担当する。

## 依存タスク

- task_01(Storage Layer 完了)
- task_02(Character Layer 完了 — CharacterContext を使用)
- task_03(Memory Layer 完了 — MemoryContext を使用)
- task_04(Knowledge Router 完了 — RouterResult を使用)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §3.4(Conversation Layer)
- 要件 `docs/02_requirements.md` §2.5(会話処理)
- 要件 `docs/02_requirements.md` §3.1(NF-PERF-06〜08)
- ビジョン `docs/01_vision.md` §3 柱2(AIっぽさの排除)
- ビジョン `docs/01_vision.md` §7 成功基準8

## 実装範囲

### 1. 型定義(`src/shared/types/conversation.ts`)

設計書 §3.4 に従って実装。

```typescript
export type OsAction = "open_notepad" | "open_browser" | "open_folder";

export interface OsCommand {
  action: OsAction;
  target?: string;  // open_browser / open_folder のみ
}

export type ConversationResponse =
  | { type: "chat"; message: string }
  | { type: "os_command"; message: string; command: OsCommand };
```

### 2. プロンプト構築(`src/conversation/prompt-builder.ts`)

```typescript
export function buildPrompt(
  charContext: CharacterContext,
  memoryContext: MemoryContext,
  routerResult: RouterResult,
  userText: string
): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};
```

#### System Prompt 構造(設計書 §3.4)

```
{charContext.systemPrompt}

# あなたの長期的な記憶
{memoryContext.semantic を要約整形}

# 関連する過去の出来事
{memoryContext.relevantEpisodic を箇条書き(各 summary)}

# 今日の特別な情報
{charContext.birthdayHint === "today" の場合のみ}

# このトピックに対する振る舞い
{routerResult.behavior}

# 出力形式(厳守)
[chat / os_command の JSON 仕様を明示]

# 重要(自称の制約)
あなたは絶対に {neverCallsSelf} と自称しません。
```

#### Messages 構造

```typescript
[
  // Few-shot:routerResult.fewshotKey に該当するもの 1〜3 例
  { role: "user", content: example.user },
  { role: "assistant", content: example.assistant },
  ...
  // birthdayReactions が必要なら追加
  // 短期記憶(直近 N 件)
  { role: "user", content: shortTerm[i].text },
  { role: "assistant", content: shortTerm[i+1].text },
  ...
  // 現在の入力
  { role: "user", content: userText },
  // Prefill
  { role: "assistant", content: "{" }
]
```

#### 出力形式指示(設計書 §3.4)

System Prompt 内に以下を含める:
```
通常の会話:
{"type": "chat", "message": "..."}

OS操作(以下の3種類のみ):
メモ帳: {"type": "os_command", "message": "...", "command": {"action": "open_notepad"}}
ブラウザ: {"type": "os_command", "message": "...", "command": {"action": "open_browser", "target": "https://..."}}
フォルダ: {"type": "os_command", "message": "...", "command": {"action": "open_folder", "target": "C:\\Users\\..."}}

それ以外の操作要求は chat 型で「できない」とキャラ口調で説明。
```

### 3. トークン管理(`src/conversation/token-counter.ts`)

設計書 §3.4 / 要件 NF-PERF-06〜08 に従って実装。

```typescript
const TOKEN_TARGET = 20_000;
const TOKEN_WARN_LIMIT = 25_000;
const TOKEN_HARD_LIMIT = 50_000;

export async function countAndCheck(
  client: Anthropic,
  request: MessageCreateParams
): Promise<{
  ok: boolean;
  tokens: number;
  reason?: "warn" | "hard_limit";
}>;
```

#### 動作仕様

- Anthropic SDK の `client.messages.countTokens(request)` を使用
- hard_limit 超過 → `ok: false` を返す(呼出側でリトライまたは失敗)
- warn_limit 超過 → `ok: true, reason: "warn"`、警告ログ
- 通常 → `ok: true`

### 4. JSON 応答パース(`src/conversation/response-parser.ts`)

設計書 §3.4「パース成功率の三段構え」に従って実装。

```typescript
export function parseConversationResponse(raw: string): ConversationResponse | null;
// 三段構えで解析
// null を返した場合はフォールバック応答を使うこと
```

#### 三段構えの実装

```typescript
function parseConversationResponse(raw: string): ConversationResponse | null {
  let text = raw.trim();

  // 1. コードフェンス除去
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  // 2. JSON 範囲抽出
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return null;
  text = text.slice(firstBrace, lastBrace + 1);

  // 3. パース + 型ガード検証
  try {
    const parsed = JSON.parse(text);
    if (isValidResponse(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function isValidResponse(obj: unknown): obj is ConversationResponse {
  // 手書きの型ガード(zod等は使わない)
  // type === "chat" の場合: message が string
  // type === "os_command" の場合:
  //   - message が string
  //   - command.action が "open_notepad" | "open_browser" | "open_folder"
  //   - open_browser / open_folder の場合は target が string
}
```

### 5. AI自称検知(`src/conversation/ai-self-check.ts`)

設計書 §3.4「AI自称防止の4層防御」第2層に従って実装。

```typescript
export interface AiSelfCheckResult {
  detected: boolean;
  matchedWord?: string;
  matchedPattern?: string;
}

export function detectAiSelfReference(
  text: string,
  neverCallsSelf: string[]
): AiSelfCheckResult;
```

#### 検知パターン(設計書 §3.4 サンプル)

```typescript
const PATTERNS_TEMPLATE = [
  "私は{w}", "私が{w}",
  "自分は{w}", "自分が{w}",
  "{w}として", "{w}なので",
  "{w}ですが", "{w}には",
];

// 例: neverCallsSelf=["AI", "アシスタント"]
// → "私はAI", "私がAI", ..., "私はアシスタント", "私がアシスタント", ... を検知
```

### 6. フォールバック応答(`src/conversation/fallback.ts`)

```typescript
export function fallbackResponse(): ConversationResponse;
// 戻り値: { type: "chat", message: "…ごめん、なんか調子悪いみたい。もう一回試してみて?" }
// キャラ口調で書く(将来は character/identity.json から取得する拡張余地あり)
```

### 7. Conversation クライアント本体(`src/conversation/client.ts`)

4層防御を統合した本会話処理。

```typescript
export async function chat(
  userText: string,
  charContext: CharacterContext,
  memoryContext: MemoryContext,
  routerResult: RouterResult,
  apiKey: string
): Promise<ConversationResponse>;
```

#### 処理フロー(設計書 §3.4「Conversation Layer の統合フロー」)

```
1. プロンプト構築(第1防御:neverCallsSelf 明示)
2. トークン数チェック(NF-PERF-08 違反なら fallback)
3. Sonnet API 呼出(Prefill 付き)
4. 応答パース(三段構え)
   ├─ パース失敗 → fallback 応答
   └─ パース成功 → 続行
5. AI自称検知(第2防御)
   ├─ 検知なし → 応答を返す
   └─ 検知あり → 第3防御へ
6. 強化プロンプトで再生成1回(第3防御)
   - System Prompt に「前回の応答に NG ワードが含まれていました。
     ENE として応答し直してください」を追記
7. 再パース → 再検知
   ├─ クリーン → 応答を返す
   └─ 検知あり → 第4防御(fallback 応答)
```

#### Claude API 呼出パラメータ

```typescript
{
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  temperature: 0.7,
  system: systemPrompt,
  messages: [...messages, { role: "assistant", content: "{" }],  // Prefill
}
```

#### 短期記憶への追記

`chat()` は短期記憶への append は行わない(呼出側 = task_10 の起動シーケンス統合で行う)。
これは「Memory Layer は Conversation を知らない」疎結合維持のため。

### 8. プロンプト強化(`src/conversation/prompt-enhancer.ts`)

第3防御の再生成用。

```typescript
export function enhancePromptForRegeneration(
  originalSystem: string,
  detectedWord: string
): string;
// 例: originalSystem + "\n\n# 重要(再生成指示)\n前回の応答に「{detectedWord}」が含まれていました。
//     キャラとして応答し直してください。"
```

## 受入チェックリスト

### 自動チェック

- [ ] `buildPrompt()` の system に neverCallsSelf の語が含まれる
- [ ] `buildPrompt()` の messages 最後が `{ role: "assistant", content: "{" }` である
- [ ] `parseConversationResponse()` が正常な JSON を正しくパース
- [ ] `parseConversationResponse()` がコードフェンス付き JSON をパース可能
- [ ] `parseConversationResponse()` が前後にテキストが混入していてもパース可能
- [ ] `parseConversationResponse()` が完全な不正データで null を返す
- [ ] `isValidResponse()` が `os_command` の action 種別を厳密に検証する
- [ ] `detectAiSelfReference("私はAIです", ["AI"])` が detected: true を返す
- [ ] `detectAiSelfReference("AIの研究をしています", ["AI"])` が detected: false を返す(自称ではない)
- [ ] `countAndCheck()` がトークン数を正しく取得する
- [ ] hard_limit 超過時にリクエストが拒否される
- [ ] AI自称検知時に再生成が1回だけ実行される
- [ ] 再生成でも検知される場合に fallback 応答が返る
- [ ] パース失敗時に fallback 応答が返る
- [ ] Vitest による単体テストが通る
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] 実際の Sonnet API を使って5種類の質問を投げ、すべてキャラ口調で応答が返る
- [ ] 「君ってAIなの?」と聞いた時、自称せずに ENE として返答する
- [ ] 「メモ帳開いて」と頼んだ時に `{type: "os_command", ...}` が返る
- [ ] 構築されたシステムプロンプトを目視確認し、キャラ性が反映されている

## やってはいけないこと

- ❌ temperature を 0.8 以上に設定(JSON 崩れリスク・設計書 §3.4)
- ❌ Prefill なしで API 呼出(JSON 出力安定性のため必須)
- ❌ zod 等のスキーマライブラリ追加(手書き型ガードで実装)
- ❌ `os_command.action` のリテラル外を許可(設計書 §3.5 ホワイトリスト方式)
- ❌ パース失敗時にユーザーに技術的エラーを見せる(必ずキャラ口調 fallback)
- ❌ AI自称検知をキャラ非依存のハードコード語で実装(identity.json から読む)
- ❌ 再生成を2回以上実施(無限ループとコスト爆発を防ぐ・1回まで)
- ❌ Conversation Layer 内で短期記憶を書き換える(疎結合維持)
- ❌ トークン上限超過時に黙って続行(必ず警告ログ・hard_limit は拒否)

## 完了の定義

`chat()` を呼ぶと、ユーザー入力に対してキャラ口調の応答(chat または os_command)が
必ず返る状態。AI自称が混入する確率が極めて低く、JSON 崩れが起きない。
トークン超過時に警告・拒否が機能する。

次のタスク(task_06)で OS Integration Layer を実装する準備が整う。

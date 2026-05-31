# Task 04: Knowledge Router 実装

## 目的

ユーザー入力のトピックを判定し、キャラの知識ドメイン5段階
(high / medium / low / none / refuse)のどれに該当するかを返す。
Claude Haiku を使った軽量・高速な判定で、本会話プロンプトの構築に使われる。

## 依存タスク

- task_01(Storage Layer 完了)
- task_02(Character Layer 完了 — knowledgeDomains を使用)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §3.2(Knowledge Router)
- 要件 `docs/02_requirements.md` §2.7(知識ドメイン判定)
- 別添 `docs/A_character_profile_samples.md` §A.3(knowledge_domains.json)

## 実装範囲

### 1. 型定義(`src/shared/types/router.ts`)

```typescript
import type { DomainLevel } from "./character";

export interface RouterResult {
  domain: DomainLevel;          // 判定されたドメイン("high"|"medium"|"low"|"none"|"refuse")
  behavior: string;              // domain.behavior をそのまま転記
  fewshotKey: string;            // domain.fewshotKey をそのまま転記
  matchedTopic?: string;         // どのトピックがマッチしたか(あれば)
  isFromCache: boolean;          // キャッシュヒットしたか
  isFromFallback: boolean;       // フォールバック使用したか
}
```

### 2. キャッシュ機構(`src/router/cache.ts`)

要件 F-ROUTE-06 に従い、直近の判定結果を LRU キャッシュする。

```typescript
const ROUTER_CACHE_SIZE = 10;

export class RouterCache {
  get(userText: string): RouterResult | undefined;
  set(userText: string, result: RouterResult): void;
  clear(): void;
}
```

#### 実装方針

- 単純な LRU(最大10件)
- キーは正規化済みユーザーテキスト(空白トリム+小文字化)
- ライブラリ追加不要(`Map` の挿入順を使った簡易実装で十分)

### 3. Router 本体(`src/router/router.ts`)

```typescript
export async function classifyTopic(
  userText: string,
  knowledgeDomains: CharacterKnowledgeDomains,
  apiKey: string
): Promise<RouterResult>;
```

#### 動作仕様(設計書 §3.2「ベストエフォート方式」)

1. キャッシュ確認 → ヒットなら即返却(`isFromCache: true`)
2. Haiku に判定リクエスト
3. 800ms のタイムアウトを設定(`NF-PERF-03`)
4. 成功 → 結果をキャッシュして返却
5. **タイムアウト・失敗時** → fallback ドメインで結果を返す(`isFromFallback: true`)
   - 例外を投げない(本会話を絶対に止めない)

#### Claude Haiku の使用方針

- モデル: `claude-haiku-4-5-20251001`
- max_tokens: 100(判定結果のみ)
- temperature: 0.0(判定なので決定的に)
- system: 判定用プロンプト
- messages: ユーザー入力1件のみ
- Prefill: `{` で開始

#### 判定プロンプトの構造

```
あなたは「キャラクター{name}」の知識範囲を判定するアシスタントです。
以下のドメインのいずれに、ユーザー入力のトピックが該当するか判定してください。

high: {high.topics の配列}
medium: {medium.topics の配列}
low: {low.topics の配列}
none: {none.topics の配列}
refuse: {refuse.topics の配列}

判定基準:
- どれにも該当しない場合は "{fallback}" を返す
- 出力は JSON 形式:{"domain": "high"|"medium"|"low"|"none"|"refuse", "matchedTopic": "..."}

ユーザー入力: "{userText}"
```

**重要**: Few-shot の中身ではなく `knowledge_domains.json` の topics 配列を使う。

#### タイムアウト実装

```typescript
const ROUTER_TIMEOUT_MS = 800;

async function classifyWithTimeout(...): Promise<RouterResult> {
  return Promise.race([
    callHaikuAndParse(...),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Router timeout")), ROUTER_TIMEOUT_MS)
    ),
  ]);
}
```

### 4. ドメイン解決(`src/router/domain-resolver.ts`)

判定された domain 名から、対応する `KnowledgeDomain` 情報を取得する。

```typescript
export function resolveDomain(
  domain: DomainLevel,
  knowledgeDomains: CharacterKnowledgeDomains
): { behavior: string; fewshotKey: string };
```

#### 動作仕様

- `knowledgeDomains.domains[domain]` を返す
- 該当ドメイン未定義の場合は fallback を返す(理論上発生しないが安全側)

### 5. フォールバック処理(`src/router/fallback.ts`)

タイムアウト・失敗時に使う fallback 結果を構築。

```typescript
export function buildFallbackResult(
  knowledgeDomains: CharacterKnowledgeDomains
): RouterResult;
```

#### 動作仕様

- `knowledgeDomains.fallback`(例: "medium")を domain とする
- `isFromFallback: true` を設定
- ログには warn レベルで「Router fallback used」と記録(個人情報は含めない)

### 6. レスポンスパース

Haiku の応答は `{"domain": "...", "matchedTopic": "..."}` の JSON。
task_05(Conversation Layer)で実装する JSON パース堅牢化と同等の処理を行う。

**注意**: パース処理は task_05 と重複するが、Router は Conversation より先に実装するため、
Router 内で完結した簡易版を実装する(後の task_05 でリファクタリングして共通化してもよい)。

```typescript
// src/router/response-parser.ts
function parseRouterResponse(raw: string): { domain: string; matchedTopic?: string } | null;
// 不正な場合は null を返す(呼出側でフォールバック)
```

## 受入チェックリスト

### 自動チェック

- [ ] `classifyTopic("Pythonの使い方", ...)` が "high" を返す(ENE の場合)
- [ ] `classifyTopic("パチンコの新台", ...)` が "none" を返す
- [ ] `classifyTopic("成人向けコンテンツ", ...)` が "refuse" を返す
- [ ] 同じユーザーテキストで2回呼ぶと2回目は `isFromCache: true`
- [ ] キャッシュは 10件で LRU として動作する(11件目で最古が削除)
- [ ] API タイムアウト(800ms 超過)時に `isFromFallback: true` で返る
- [ ] タイムアウト時に例外が throw されない
- [ ] API 失敗(401等)時にも `isFromFallback: true` で返る
- [ ] Vitest による単体テストが通る(モックを使った Haiku 応答)
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] 実際の Haiku API を使って5種類の質問を投げ、それぞれ妥当なドメインに分類される
  - IT質問 → high
  - 雑談 → medium または low
  - パチンコ等 → none
  - 成人向け → refuse
- [ ] タイムアウト発生時にもキャラの会話が止まらない(本会話への影響なし)

## やってはいけないこと

- ❌ Router の失敗で本会話を停止する(ベストエフォート方式・設計書 §3.2)
- ❌ Router の判定結果なしで Conversation を呼ばない設計(必ず fallback を返す)
- ❌ knowledgeDomains.topics をコードにハードコード(必ず JSON から)
- ❌ Sonnet モデルを使う(Haiku で十分・コスト削減)
- ❌ Router のレスポンスをユーザーに直接見せる(内部判定用)
- ❌ キャッシュキーに timestamp 等の毎回変わる値を含める
- ❌ Router 単体で会話履歴を持つ(ステートレスに保つ)

## 完了の定義

`classifyTopic(userText, knowledgeDomains, apiKey)` を呼ぶと、
800ms 以内に必ず RouterResult が返る(キャッシュ・正常・フォールバックいずれか)。
失敗ケースでも例外を投げない。

次のタスク(task_05)で Conversation Layer を実装する準備が整う。

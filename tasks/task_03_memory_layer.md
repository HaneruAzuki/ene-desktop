# Task 03: Memory Layer 実装

## 目的

3層構造(短期・中期・長期)の記憶システムを実装する。
記憶の保存・読込・検索・抽出を担当し、Conversation Layer から利用される。

## 依存タスク

- task_01(Storage Layer 完了 — `readJson`, `writeJson`, `listJsonFiles` を使用)
- task_02(Character Layer 完了 — active キャラの参照に使用)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §3.3(Memory Layer)
- 設計書 `docs/03_design.md` §5.2(Episodic Memory ファイル例)
- 設計書 `docs/03_design.md` §5.3(ファイル命名規則)
- 設計書 `docs/03_design.md` §5.5(キャラ別記憶構造)
- 要件 `docs/02_requirements.md` §2.9(記憶システム)
- ビジョン `docs/01_vision.md` §3 柱1(忘却の思想)

## 実装範囲

### 1. 型定義(`src/shared/types/memory.ts`)

設計書 §3.3 に従って実装。

```typescript
export interface ShortTermEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: string;  // ローカルタイム+offset
  extracted: boolean; // 中期記憶への抽出済みフラグ
}

export interface EpisodicMemory {
  date: string;        // ローカルタイム+offset
  topic: string;
  summary: string;     // 200文字以内を目安
  tags: string[];
  importance: number;  // 1-5(必須・将来の忘却機構で参照)
  category: string;    // health, work, hobby など
}

// SemanticMemory の2層構造
export type ExtraValue = string | string[] | number | boolean;

export interface SemanticMemory {
  // コアフィールド(スキーマ検証対象)
  version: number;
  userName?: string;
  preferences?: Record<string, string>;
  longTermGoals?: string[];
  personality?: string[];
  // 拡張領域(LLMが自由に追記)
  extra?: Record<string, ExtraValue>;
}

// 検索用
export interface MemorySearchQuery {
  tags?: string[];
  category?: string;
  minImportance?: number;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;  // デフォルト 5
}

// レイヤー間で受け渡すコンテキスト型
export interface MemoryContext {
  semantic: SemanticMemory;
  shortTerm: ShortTermEntry[];
  relevantEpisodic: EpisodicMemory[];
}
```

### 2. 短期記憶管理(`src/memory/short-term.ts`)

```typescript
export async function getShortTerm(): Promise<ShortTermEntry[]>;
// 存在しない場合は空配列を返す

export async function appendShortTerm(entry: ShortTermEntry): Promise<void>;
// 追加後、20件を超える場合は抽出処理を呼んでからトリム

export async function clearShortTerm(): Promise<void>;
// アプリ終了時に呼ばれる(終了シーケンスの一部)

export async function getUnextractedEntries(): Promise<ShortTermEntry[]>;
// extracted: false のエントリのみ返す

export async function markAsExtracted(timestamps: string[]): Promise<void>;
// 指定された timestamp のエントリの extracted を true にする
```

#### 短期記憶の保持件数(設計書 §3.3)

定数 `SHORT_TERM_MAX_ENTRIES = 20` を定義。

### 3. 長期記憶管理(`src/memory/semantic.ts`)

```typescript
export async function getSemantic(): Promise<SemanticMemory>;
// 存在しない場合は { version: 1 } を返す

export async function saveSemantic(memory: SemanticMemory): Promise<void>;
// スキーマ検証してから保存

export async function updateSemantic(patch: Partial<SemanticMemory>): Promise<void>;
// 既存の semantic.json に patch をマージして保存
// extra フィールドは深くマージ(既存値を残してから上書き)
```

#### スキーマ検証(設計書 §3.3「SemanticMemory のスキーマ検証方針」)

**コアフィールド**(厳密):
- `version` は必須・number 型
- 既知フィールド(`userName` 等)は定義された型と一致
- 型不一致なら拒否(警告ログ)し、当該フィールドを無視

**`extra` 領域**(構造のみ):
- オブジェクトであること
- 各値が `ExtraValue` 型のいずれか
- 中身の意味は問わない

```typescript
// src/memory/schema-validation.ts(別ファイル推奨)
export function validateSemantic(obj: unknown): SemanticMemory;
// 手書きの型ガード(zod等は使わない)
// 不正フィールドは無視、コア違反は例外
```

### 4. 中期記憶管理(`src/memory/episodic.ts`)

```typescript
export async function saveEpisodic(memory: EpisodicMemory): Promise<void>;
// パス: data/memory/{activeCharId}/episodic/{year}/{category}/{filename}.json
// filename は nowLocalIsoForFilename() を使う

export async function searchEpisodic(
  query: MemorySearchQuery
): Promise<EpisodicMemory[]>;
// 全 Episodic ファイルを走査(MVP方針・設計書 §3.3)
// query 条件に合致したものを importance 降順でソート
// query.limit 件数まで返す(デフォルト 5)

export async function loadAllEpisodicFiles(): Promise<EpisodicMemory[]>;
// 全 Episodic を読み込む(検索の内部実装で使用)
// 私用ヘルパーだが、テスト容易性のためexportしておく
```

#### MVP の検索仕様(設計書 §3.3)

- タグ検索(query.tags のいずれかが entry.tags に含まれる)
- カテゴリ検索(完全一致)
- 重要度フィルタ(>= query.minImportance)
- 日付フィルタ(year が範囲内)
- **ベクトル検索・LLM再ランキングは MVP 対象外**(設計書 §11.4)

#### スケール想定(設計書 §3.3)

- MVPでは全ファイル走査で 3年規模(約6,000件)まで実用可能
- それ以降は忘却機構(設計書 §11.6)の実装が必要
- インデックスファイル方式は採用しない(忘却思想と整合しない)

### 5. 記憶抽出(`src/memory/extractor.ts`)

```typescript
export async function extractMemoryFromConversation(
  unextractedEntries: ShortTermEntry[],
  characterContext: CharacterContext
): Promise<{
  episodic?: EpisodicMemory;
  semanticPatch?: Partial<SemanticMemory>;
}>;
```

#### 動作仕様(設計書 §3.3)

- 引数は `extracted: false` のエントリのみ(呼出側でフィルタ済み)
- Claude API(Sonnet)を使って、会話から記憶を抽出
- 抽出すべき内容がない場合は両方 undefined を返す
- summary は **200文字以内**を目安(プロンプトで指示・F-MEM-E-06)
- importance は **1〜5の整数で必須**(F-MEM-E-06)

#### 抽出プロンプトの方針

System Prompt の例(キャラ依存しない実装側プロンプト):
```
以下の会話から、ユーザーについて重要な事実・嗜好・出来事を抽出してください。
出力は以下のJSON形式:
{
  "episodic": { ... } | null,
  "semanticPatch": { ... } | null
}

抽出基準:
- 一過性の話題ではなく、長期的に意味のある情報
- summary は200文字以内
- importance は 1(些細)〜5(極めて重要)
- 該当する情報がなければ null
```

#### 重要

- このプロンプトは**ユーザーキャラとは独立**(ENE 等のキャラ性を反映しない)
- 抽出側は中立的な観察者として動作

### 6. 抽出トリガの統合(`src/memory/extraction-trigger.ts`)

```typescript
export async function extractFromShortTerm(
  reason: "overflow" | "shutdown",
  characterContext: CharacterContext
): Promise<void>;
```

#### 動作仕様(設計書 §3.3)

1. `getUnextractedEntries()` で未抽出エントリを取得
2. 空なら何もしない
3. `extractMemoryFromConversation(...)` で抽出
4. `episodic` が返ったら `saveEpisodic()`
5. `semanticPatch` が返ったら `updateSemantic()`
6. 抽出に使ったエントリの `extracted` を true に更新(`markAsExtracted()`)

#### 呼出箇所

- 短期記憶 20件超過時(`appendShortTerm` 内部から)
- アプリ終了シーケンス(設計書 §7.2、task_10 で組み立て)

### 7. MemoryContext 構築(`src/memory/context-builder.ts`)

```typescript
export async function buildMemoryContext(
  query: MemorySearchQuery
): Promise<MemoryContext>;
```

#### 動作仕様

- `getSemantic()` で長期記憶を取得
- `getShortTerm()` で短期記憶を取得
- `searchEpisodic(query)` で関連する中期記憶を取得
- 全てを統合した `MemoryContext` を返す

## 受入チェックリスト

### 自動チェック

- [ ] 短期記憶への append が 20件超過時に抽出を呼ぶ
- [ ] 抽出済みエントリ(`extracted: true`)は再抽出されない
- [ ] Episodic Memory がキャラ別ディレクトリ(`data/memory/{characterId}/`)に保存される
- [ ] ファイル名がローカルタイム形式(`YYYY-MM-DDTHH-MM-SS.json`)である
- [ ] `searchEpisodic` がタグ・カテゴリ・重要度・日付の全条件で正しくフィルタする
- [ ] `searchEpisodic` のデフォルト limit が 5 である
- [ ] `searchEpisodic` の結果が importance 降順でソートされている
- [ ] `validateSemantic()` がコアフィールド型不一致を拒否する
- [ ] `validateSemantic()` が extra フィールドの未知キーを保持する
- [ ] `updateSemantic()` が `extra` を深くマージする(既存値が残る)
- [ ] `extractMemoryFromConversation()` が summary を200文字以内に収める
- [ ] `extractMemoryFromConversation()` が importance を1〜5の整数で返す
- [ ] 抽出処理が `data/memory/{characterId}/episodic/{year}/{category}/` に正しく階層化する
- [ ] Vitest による単体テストが通る
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] 数件の会話を行った後、生成された Episodic Memory ファイルを目視確認し、
      キャラ口調を含まず中立的な観察として記述されている
- [ ] Semantic Memory が一過性の話題で更新されすぎていない
      (重要な事実のみ抽出されている)

## やってはいけないこと

- ❌ 会話の逐語ログを保存(CLAUDE.md §12・設計書 §3.6)
- ❌ `data/memory/` 直下にファイルを置く(必ず `{characterId}/` 配下)
- ❌ UTC タイムスタンプ(`new Date().toISOString()`)の使用
- ❌ インデックスファイル(`index.json`)による検索高速化
      (忘却思想と整合しないため・設計書 §3.3「設計判断」)
- ❌ 抽出側プロンプトにキャラ口調を混ぜる(抽出は中立的な観察)
- ❌ zod 等のスキーマライブラリ追加(手書き型ガードで実装・設計書 §3.4)
- ❌ Semantic の version フィールドの破壊的変更(後方互換性必須・設計書 §11.8)
- ❌ extra フィールドの中身を厳密に型チェック(LLMの自由を残す)

## 完了の定義

ShortTerm / Episodic / Semantic の3層が動作し、抽出トリガが
20件超過時と終了時で正しく走る。Conversation Layer から
`buildMemoryContext()` を呼ぶだけで使える状態。

次のタスク(task_04)で Knowledge Router を実装する準備が整う。

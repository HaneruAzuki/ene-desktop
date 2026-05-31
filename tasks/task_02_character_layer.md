# Task 02: Character Layer 実装

## 目的

キャラクター人格情報(identity / background / knowledge_domains / fewshot)を
ロードし、Conversation Layer・Knowledge Router が利用可能な
`CharacterContext` 型で提供する。

## 依存タスク

- task_00(初期セットアップ完了)
- task_01(Storage Layer 完了 — `readJson` を使用)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §3.1(Character Layer)
- 設計書 `docs/03_design.md` §5.1(キャラクタープロファイル参照)
- 別添 `docs/A_character_profile_samples.md`(JSONの完全形)
- CLAUDE.md §5(キャラクター実装規約)

## 実装範囲

### 1. 型定義(`src/shared/types/character.ts`)

設計書 §3.1 に従って実装。

```typescript
// 4ファイルそれぞれの型
export interface CharacterIdentity {
  characterId: string;
  name: string;
  ageAppearance: string;
  gender: string;
  birthday?: { month: number; day: number };
  personality: {
    core: string;
    tone: string;
    firstPerson: string;
    speechEndings: string[];
  };
  selfRecognition: {
    callsSelf: string;
    neverCallsSelf: string[];
    aiQuestionHandling: string;
  };
}

export interface CharacterBackground {
  characterId: string;
  birthplace: string;
  family: Record<string, string>;
  education: string;
  hobbies: string[];
  dislikes: string[];
  lifeExperience: {
    exposedTo: string[];
    notExposedTo: string[];
  };
}

export type DomainLevel = "high" | "medium" | "low" | "none" | "refuse";

export interface KnowledgeDomain {
  topics: string[];
  behavior: string;
  rationale: string;
  fewshotKey: string;
}

export interface CharacterKnowledgeDomains {
  characterId: string;
  domains: Record<DomainLevel, KnowledgeDomain>;
  fallback: DomainLevel;
}

export interface FewshotExample {
  user: string;
  assistant: string;
}

export interface CharacterFewshot {
  characterId: string;
  examples: Record<string, FewshotExample[]>;
  birthdayReactions?: {
    celebrated: FewshotExample[];
    forgotten: FewshotExample[];
  };
  firstLaunchGreeting?: FewshotExample[];
  normalGreeting?: FewshotExample[];
}

// active-character.json
export interface BirthdayHistoryEntry {
  year: number;
  celebrated: boolean;
  celebratedAt?: string;
}

export interface ActiveCharacter {
  version: number;
  characterId: string;
  selectedAt: string;
  birthdayHistory: BirthdayHistoryEntry[];
  firstLaunchCompleted: boolean;
}

// レイヤー間で受け渡すコンテキスト型
export interface CharacterContext {
  identity: CharacterIdentity;
  background: CharacterBackground;
  knowledgeDomains: CharacterKnowledgeDomains;
  fewshot: CharacterFewshot;
  portraitPath: string;  // 絶対パス
  systemPrompt: string;  // 構築済みのシステムプロンプト文字列
  birthdayHint?: "today" | "forgotten" | null;
}
```

### 2. プロファイルローダー(`src/character/loader.ts`)

```typescript
export async function loadCharacterProfile(
  characterId: string
): Promise<{
  identity: CharacterIdentity;
  background: CharacterBackground;
  knowledgeDomains: CharacterKnowledgeDomains;
  fewshot: CharacterFewshot;
  portraitPath: string;
}>;
```

#### 動作仕様

- `/characters/{characterId}/` 配下の4つの JSON を `readJson` でロード
- いずれかが欠けていたら例外を throw する(キャラ定義の不整合は致命的)
- 各 JSON の `characterId` フィールドが引数と一致しない場合も例外を throw
- portrait.png の絶対パスは返すが、存在チェックはしない(任意配置可能)

### 3. active-character 管理(`src/character/active-character.ts`)

```typescript
export async function loadOrCreateActiveCharacter(): Promise<ActiveCharacter>;
// ファイルが存在しない場合、デフォルト値で生成して保存
// デフォルト: characterId="ene", birthdayHistory=[], firstLaunchCompleted=false

export async function saveActiveCharacter(active: ActiveCharacter): Promise<void>;

export async function markFirstLaunchCompleted(): Promise<void>;
// 初回起動完了後に呼ぶ

export async function recordBirthdayCelebrated(year: number): Promise<void>;
// ユーザーが誕生日に触れた時に呼ぶ
```

### 4. システムプロンプト構築(`src/character/system-prompt-builder.ts`)

設計書 §3.1 §3.4 に従い、キャラクター人格情報からシステムプロンプトを構築。

```typescript
export function buildSystemPrompt(
  identity: CharacterIdentity,
  background: CharacterBackground,
  knowledgeDomains: CharacterKnowledgeDomains
): string;
```

#### システムプロンプトの構成要素

1. **キャラクター人格**:`identity.name`、`personality.core`、`tone`、`firstPerson`、`speechEndings`
2. **背景情報**:`background` から関連項目を抜粋
3. **AI自称防止**:`identity.selfRecognition.neverCallsSelf` を**明示的に列挙**
   - 例:「あなたは絶対に "AI" "アシスタント" "モデル" "プログラム" と自称しません」
4. **応答形式の指示**:JSON出力の構造を明示(設計書 §3.4)

### 5. 誕生日判定(`src/character/birthday-checker.ts`)

```typescript
export function checkBirthday(
  identity: CharacterIdentity,
  active: ActiveCharacter,
  todayLocal: { year: number; month: number; day: number }
): "today" | "forgotten" | null;
```

#### 判定ロジック(設計書 §3.1)

- `identity.birthday` が未設定 → null
- 今日が誕生日 → "today"
- 今年の誕生日が過ぎていて、`birthdayHistory` の該当年が `celebrated: false`(または該当年エントリ無し)→ "forgotten"
- 上記以外 → null

**重要**:`new Date()` の月は 0-indexed なので注意。
`todayLocal` は `nowLocalYmd()`(task_01 で実装)から取得。

### 6. CharacterContext 構築(`src/character/context-builder.ts`)

```typescript
export async function buildCharacterContext(): Promise<CharacterContext>;
```

#### 動作仕様

- `loadOrCreateActiveCharacter()` で active キャラを取得
- `loadCharacterProfile(active.characterId)` でプロファイルをロード
- `buildSystemPrompt(...)` でシステムプロンプトを構築
- `checkBirthday(...)` で誕生日状態を判定
- 全てを統合した `CharacterContext` オブジェクトを返す

## 受入チェックリスト

### 自動チェック

- [ ] `loadCharacterProfile("ene")` で別添A のサンプル相当の内容がロードできる
- [ ] 4ファイルのいずれかが欠けている場合に例外が throw される
- [ ] `characterId` 不一致時に例外が throw される
- [ ] `loadOrCreateActiveCharacter()` が初回起動時にデフォルト値を生成する
- [ ] `buildSystemPrompt()` の出力に `neverCallsSelf` の語が含まれる
- [ ] `checkBirthday()` が誕生日当日に "today" を返す
- [ ] `checkBirthday()` が誕生日翌日かつ未祝福で "forgotten" を返す
- [ ] `checkBirthday()` が誕生日未設定キャラで null を返す
- [ ] `buildCharacterContext()` で完全な CharacterContext が取得できる
- [ ] Vitest による単体テストが通る
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] 構築されたシステムプロンプトが日本語として自然
- [ ] AI自称防止の指示文が、キャラの世界観を壊さない表現になっている

## やってはいけないこと

- ❌ キャラ属性をコードにハードコードする(必ず JSON から読む)
- ❌ `neverCallsSelf` 配列をコードに書く(必ず identity.json から)
- ❌ 「ENE」など特定キャラ名のハードコード(active.characterId を使う)
- ❌ 状態管理(感情パラメータ等)の実装(CLAUDE.md §5.3)
- ❌ プロファイル不整合時の自動回復(致命的なので例外を投げる)
- ❌ `new Date().getUTCMonth()` 等の UTC 関数(ローカルタイム必須)

## 完了の定義

`buildCharacterContext()` を呼ぶだけで、ENE の完全なキャラクター情報・
誕生日状態・システムプロンプトが取得できる状態。

次のタスク(task_03)で Memory Layer を実装する準備が整う。

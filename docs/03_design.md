# 03. 設計書:Desktop Character Agent「ENE」

> **このドキュメントの位置づけ**
> 要件定義書(`02_requirements.md`)で定義された「何を作るか」を、
> 「どうやって作るか」の**技術的な実装方針**に落とし込んだ文書。
>
> Claude Codeはこの文書を参照し、実装方針の判断を行う。
> ビジョン(`01_vision.md`)や規約(`CLAUDE.md`)と矛盾した場合は、
> 上位ドキュメント側を優先する。

---

## 1. 設計の全体方針

### 1.1 基本思想

本プロダクトは以下の3つの設計思想に基づく。

1. **疎結合**:各レイヤーは独立して差し替え可能。インターフェース経由のみで通信。
2. **静的設定 vs 動的処理の分離**:キャラ依存値はJSON、ロジックはコード。
3. **失敗の局所化**:あるレイヤーの失敗が全体停止を招かない設計。

### 1.2 技術スタック(確定)

ライブラリは「同梱(配布物に含まれる)」と「開発時のみ」に分類される。
前者はユーザーPCで動くコードに含まれ、後者はビルド時にのみ使用される。

#### 同梱ライブラリ(dependencies — exe に含まれる)

| 項目 | 採用技術 | バージョン | 選定理由 |
|------|---------|-----------|---------|
| アプリ基盤 | Electron | `^30.x` | 透過ウィンドウ・常駐表示・Windows互換性 |
| UIフレームワーク | React | `^18.x` | 将来拡張性・コンポーネント化 |
| Claude API | @anthropic-ai/sdk | `^0.30.x` | Anthropic公式SDK |
| ロギング | electron-log | `^5.x` | Electron標準的なロガー |
| APIキー暗号化 | Electron `safeStorage` | (built-in) | OS標準暗号化機構 |

#### 開発時のみ(devDependencies — exe には含まれない)

| 項目 | 採用技術 | バージョン | 選定理由 |
|------|---------|-----------|---------|
| 言語 | TypeScript | `^5.x`(strict) | 型安全・長期保守・Claude Code相性 |
| ランタイム | Node.js | 24 LTS | Electronとの互換性。2026年時点で LTS 系列が 24 に移行し、winget で 20 LTS が入手不可となったためユーザー承認のうえ 20→24 に更新(旧: 20 LTS) |
| ビルドツール | Vite | `^5.x` | 高速・TypeScript標準対応 |
| Electron統合 | electron-vite | `^2.x` | Electron + Vite + React の統合 |
| ビルド/配布 | electron-builder | `^24.x` | Windows向けexe生成 |
| テスト | Vitest | `^1.x` | 高速・TS標準対応 |
| Lint | ESLint | `^8.x` | コード品質 |
| Lint(TS拡張) | @typescript-eslint | `^7.x` | TypeScript用ルール |
| フォーマッタ | Prettier | `^3.x` | コード整形 |
| パッケージマネージャ | npm | `^10.x` | シンプルさ優先 |

#### バージョン指定方針

- バージョン指定は **`^` (キャレット)を基本**とする
  - マイナー・パッチバージョンの自動更新を許す
  - メジャーバージョン更新は破壊的変更を伴うため要承認
- **`package-lock.json` を必ずコミットする**
  - これにより `npm ci` で同一バージョンの組み合わせを再現できる
  - 数年後にビルドし直しても同じ依存ツリーを得られる
- `latest` 指定は**禁止**(再現性が損なわれるため)
- メジャーバージョンの更新は、必ずユーザー承認を経た上で本表を更新

**重要**:上記以外のライブラリを追加する場合は、必ずユーザー承認を得ること。

> 📌 **この表は CLAUDE.md §2 から参照される「技術スタックの唯一の真実の源」である。**
> ここを変更したら、その変更がプロジェクト全体に直ちに反映される。
> 追加・削除・バージョン変更時は、必ずユーザー承認を経た上で本表を更新すること。

### 1.3 アーキテクチャ全体図

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                    │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────┐  │
│  │Character│ │Knowledge │ │ Memory  │ │   OS    │  │
│  │  Layer  │ │  Router  │ │  Layer  │ │Integration│ │
│  └─────────┘ └──────────┘ └─────────┘ └─────────┘  │
│       └──────────┬─────────────┘                    │
│              ┌───┴────┐                             │
│              │Conversation│                          │
│              │   Layer    │ ──→ Claude API          │
│              └────────────┘                          │
└────────────────────┬────────────────────────────────┘
                     │ IPC
┌────────────────────┴────────────────────────────────┐
│  Electron Renderer Process (React + Vite)           │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────┐   │
│  │ Character    │ │ Speech       │ │ Input      │   │
│  │ Display      │ │ Bubble       │ │ Area       │   │
│  │ (Transparent)│ │              │ │            │   │
│  └──────────────┘ └──────────────┘ └────────────┘   │
└─────────────────────────────────────────────────────┘
```

**重要な設計判断**:
- ビジネスロジック(キャラ・記憶・API呼出)は **Main Process** に集約
- UI表示のみが **Renderer Process** で動作
- 両者は **IPC(Inter-Process Communication)** で型安全に通信
- これにより、UIの差し替え(将来のLive2D化等)が容易になる

---

## 2. ディレクトリ構成(完全版)

> 📌 **このツリー図は CLAUDE.md §3 から参照される「ディレクトリ構成の唯一の真実の源」である。**
> 新規ディレクトリの追加・既存ディレクトリの削除・役割変更は、必ずユーザー承認を経た上で本ツリーを更新すること。

```
ene-desktop/
├── CLAUDE.md
├── README.md
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── electron.vite.config.ts        ← electron-vite設定
├── electron-builder.yml           ← ビルド設定
├── .eslintrc.cjs
├── .prettierrc
├── .gitignore
│
├── docs/                          ← 設計・要件ドキュメント
│   ├── 01_vision.md
│   ├── 02_requirements.md
│   └── 03_design.md
│
├── tasks/                         ← 実装タスク
│   └── task_NN_*.md
│
├── src/
│   ├── main/                      ← Electron main process
│   │   ├── index.ts               ← エントリポイント
│   │   ├── window.ts              ← BrowserWindow設定(透過)
│   │   ├── tray.ts                ← タスクトレイ・コンテキストメニュー
│   │   ├── ipc.ts                 ← IPCハンドラ集約
│   │   └── lifecycle.ts           ← 起動・終了処理
│   │
│   ├── preload/                   ← Preload script
│   │   └── index.ts               ← Renderer向けAPI公開
│   │
│   ├── renderer/                  ← Renderer (React)
│   │   ├── index.html
│   │   ├── main.tsx               ← Reactエントリ
│   │   ├── App.tsx                ← ルートコンポーネント
│   │   ├── components/
│   │   │   ├── CharacterDisplay.tsx
│   │   │   ├── SpeechBubble.tsx
│   │   │   └── InputArea.tsx
│   │   ├── hooks/
│   │   │   └── useEneAPI.ts       ← IPC呼出フック
│   │   └── styles/
│   │       └── global.css
│   │
│   ├── character/                 ← Character Layer
│   │   ├── loader.ts              ← Profileロード
│   │   ├── context-builder.ts     ← プロンプト構築
│   │   ├── birthday.ts            ← 誕生日判定
│   │   └── types.ts
│   │
│   ├── router/                    ← Knowledge Router
│   │   ├── classifier.ts          ← Haiku呼出
│   │   ├── cache.ts               ← 判定結果キャッシュ
│   │   └── types.ts
│   │
│   ├── memory/                    ← Memory Layer
│   │   ├── short-term.ts
│   │   ├── episodic.ts
│   │   ├── semantic.ts
│   │   ├── search.ts              ← MVP: タグ検索
│   │   ├── extractor.ts           ← 会話から記憶抽出
│   │   └── types.ts
│   │
│   ├── conversation/              ← Conversation Layer
│   │   ├── client.ts              ← Claude APIクライアント
│   │   ├── prompt-builder.ts      ← 統合プロンプト構築
│   │   ├── response-parser.ts     ← JSON応答解析
│   │   └── types.ts
│   │
│   ├── os/                        ← OS Integration Layer
│   │   ├── executor.ts            ← コマンド実行
│   │   ├── whitelist.ts           ← 許可リスト定義
│   │   └── types.ts
│   │
│   ├── storage/                   ← データ永続化
│   │   ├── encryption.ts          ← safeStorageラッパー
│   │   ├── paths.ts               ← パス管理
│   │   └── json-store.ts          ← JSONファイル操作
│   │
│   └── shared/                    ← 共有型・ユーティリティ
│       ├── types/
│       │   ├── ipc.ts             ← IPC型定義
│       │   ├── character.ts
│       │   ├── memory.ts
│       │   └── conversation.ts
│       ├── constants.ts
│       └── logger.ts              ← electron-logラッパー
│
├── characters/                    ← キャラ定義(配布物に含む)
│   └── ene/
│       ├── identity.json
│       ├── background.json
│       ├── knowledge_domains.json
│       ├── fewshot.json
│       └── portrait.png
│
├── tests/
│   ├── unit/                      ← 単体テスト
│   │   ├── character/
│   │   ├── router/
│   │   ├── memory/
│   │   └── os/
│   └── acceptance/                ← 受入テスト
│       └── task_NN.md
│
├── resources/                     ← ビルドリソース
│   ├── icon.ico                   ← アプリアイコン
│   ├── tray-icon.png              ← タスクトレイアイコン(小さめ・16〜32px推奨)
│   └── installer-icon.ico
│
├── (実行時に生成 / exeと同じディレクトリ) ─── ポータブルデータ(平文JSON)
│   └── data/                     ← ユーザーデータ(可搬性あり)
│       ├── memory/
│       │   └── {characterId}/    ← キャラ別に分離(例: ene/)
│       │       ├── episodic/
│       │       │   └── {year}/{category}/
│       │       ├── semantic.json
│       │       └── short-term.json
│       ├── logs/                  ← アプリ動作ログ(個人情報を含まないメタ情報のみ)
│       ├── config/
│       │   ├── window-position.json
│       │   └── active-character.json  ← 現在使用中キャラと最小状態
│       └── characters-custom/    ← 将来:ユーザー追加キャラ
│
└── (実行時に生成 / OSユーザー領域) ─────── マシン固定データ(暗号化)
    └── %APPDATA%/ene-desktop/    ← Windows標準位置
        └── api-key.enc           ← safeStorageで暗号化されたAPIキー
```

**重要な設計判断(部分暗号化方式)**:

本プロダクトは「ポータブル性」と「APIキーのセキュリティ」を両立するため、
**データを2箇所に分散保存する**部分暗号化方式を採用する。

| 区分 | 保存場所 | 暗号化 | 可搬性 | 理由 |
|------|---------|--------|--------|------|
| ポータブルデータ | `(exeの隣)/data/` | なし | あり | ユーザーが直接読める透明性・可搬性を優先 |
| マシン固定データ | `%APPDATA%/ene-desktop/` | あり(safeStorage) | なし | APIキーの機密性確保。safeStorageの鍵はOS/ユーザー/マシン固定のため、`data/` に置いても別PCで復号不可 |

**ユースケース例**:USBにアプリと記憶を入れて別PCで使う場合
1. USBから別PCで起動
2. `data/memory/{characterId}/` 配下の記憶は読込成功(ENEは過去を覚えている)
3. `%APPDATA%/ene-desktop/api-key.enc` が新PCには存在しない
4. ENEがAPIキー再入力をユーザーに求める
5. ユーザーが入力 → 新PCのAPPDATAに保存 → 通常会話開始

これにより、ビジョン§3 柱4「ポータブル」と機密性が両立する。

---

## 3. レイヤー詳細設計

### 3.1 Character Layer

#### 責務
- キャラクタープロファイル(4ファイル)のロード
- Knowledge Routerの結果に応じたContext構築
- 誕生日判定とキャラ固有反応の付与

#### 主要型定義

```typescript
// src/shared/types/character.ts

export interface CharacterIdentity {
  characterId: string;
  name: string;
  ageAppearance: string;          // "少女" など抽象表現
  gender: string;
  birthday?: {                     // 任意
    month: number;                 // 1-12
    day: number;                   // 1-31
  };
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
  birthplace?: string;
  family?: Record<string, string>;
  education?: string;
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
  rationale?: string;
  fewshotKey: string;
}

export interface KnowledgeDomains {
  characterId: string;
  domains: Record<DomainLevel, KnowledgeDomain>;
  fallback: DomainLevel;
}

export interface FewshotExample {
  user: string;
  assistant: string;
}

export interface Fewshots {
  characterId: string;
  examples: Record<string, FewshotExample[]>;
  birthdayReactions?: {            // 誕生日関連の特別反応
    celebrated: FewshotExample[];
    forgotten: FewshotExample[];
  };
}

export interface CharacterProfile {
  identity: CharacterIdentity;
  background: CharacterBackground;
  knowledgeDomains: KnowledgeDomains;
  fewshots: Fewshots;
}

export interface CharacterContext {
  systemPrompt: string;
  fewshotMessages: FewshotExample[];
  birthdayHint?: string;           // 誕生日当日のヒント
}
```

#### 主要関数

```typescript
// src/character/loader.ts
export async function loadCharacter(characterId: string): Promise<CharacterProfile>;

// src/character/context-builder.ts
export function buildCharacterContext(
  profile: CharacterProfile,
  routingResult: RoutingResult,
  currentDate: Date
): CharacterContext;

// src/character/birthday.ts
export function checkBirthday(
  identity: CharacterIdentity,
  currentDate: Date
): "today" | "approaching" | "passed" | null;
```

#### 誕生日機能の設計

- `identity.json` の `birthday` は **任意項目**
- 当日(month/dayが一致)なら、Few-shotに `birthdayReactions.celebrated` を注入
- 当日にユーザーが触れずに過ぎた場合、翌日以降のセッションで
  `birthdayReactions.forgotten` を注入(キャラが拗ねる/不機嫌になる演出)

#### 状態管理の方針(最小状態管理)

「忘れられた誕生日」を検知するには、**「今年の誕生日が祝われたかどうか」を
記録する最小限の状態が必要**となる。完全な状態レス設計は本機能と両立しないため、
**設計原則を「不機嫌度の数値管理など複雑な状態は避ける」「ただし最小限の事実記録は許容する」と整理する**。

#### 状態の保存先

最小状態は `active-character.json` の `birthdayHistory` フィールドに記録する
(詳細は §5.4「キャラクター運用状態の管理」を参照)。

```json
{
  "characterId": "ene",
  "birthdayHistory": [
    { "year": 2026, "celebrated": true, "celebratedAt": "2026-08-15T20:30:00+09:00" }
  ]
}
```

#### 判定ロジック

```typescript
// checkBirthday の挙動(疑似コード)

function checkBirthday(identity, currentDate, history): BirthdayStatus {
  if (!identity.birthday) return null;  // 誕生日未設定キャラ

  const { month, day } = identity.birthday;
  const isToday = currentDate.month === month && currentDate.day === day;
  const isAfterBirthday = /* 今年の誕生日が過ぎた判定 */;

  const thisYear = currentDate.year;
  const thisYearHistory = history.find((h) => h.year === thisYear);

  if (isToday) return "today";
  if (isAfterBirthday && !thisYearHistory?.celebrated) return "forgotten";
  return null;
}

// status === "today"     → celebrated 用 Few-shot を準備
// status === "forgotten" → forgotten 用 Few-shot を準備
// ユーザーが当日に祝ったら history に celebrated: true を記録
```

#### 設計上の注意

- **「不機嫌度」などの感情パラメータは持たない**(状態が複雑化するため)
- **「祝われた / 祝われていない」という二値の事実のみ記録する**
- ユーザーの反応に対する具体的なキャラの応答は、**すべて Few-shot で表現**する
- 翌年の誕生日が来たら、新しいエントリを history に追加(過去は残す)

### 3.2 Knowledge Router

#### 責務
- ユーザー入力のトピック判定
- knowledge_domainsとの照合
- 結果のキャッシュ

#### 設計方針:ベストエフォート方式

Knowledge Routerは「精度を完璧にする機能」ではなく「会話を自然にする補助」と
位置づける。タイムアウト超過時は fallback ドメイン(通常 `medium`)を使用し、
**本会話の進行を絶対に止めない**。

これにより、ネットワークが遅い環境でもユーザー体験が悪化しない。

#### 主要型定義

```typescript
// src/shared/types/router.ts

// DomainLevel は src/shared/types/character.ts で定義された
// "high" | "medium" | "low" | "none" | "refuse" を使用する

export interface RoutingResult {
  topic: string;
  domain: DomainLevel;     // 唯一のレベル指標(数値レベルは持たない)
  behavior: string;        // 利便性のため KnowledgeDomain から複製
  fewshotKey: string;      // 利便性のため KnowledgeDomain から複製
}
```

> 📌 **設計判断**:以前は `level: number` を持っていたが、MVPでは使用機会が
> 無いため削除。将来「数値で段階制御したい」となった時点で再導入する。

#### 実装方針

```typescript
// src/router/classifier.ts
export async function classify(
  userText: string,
  knowledgeDomains: KnowledgeDomains
): Promise<RoutingResult>;
```

- **使用モデル**:`claude-haiku-4-5-20251001`(軽量・高速)
- **タイムアウト**:**800ms**(Haikuの実測レイテンシ中央値+α)
- **失敗時の挙動**:
  - タイムアウト → `knowledgeDomains.fallback` を使用(本会話は続行)
  - API エラー → `knowledgeDomains.fallback` を使用(本会話は続行)
  - JSON 不正 → `knowledgeDomains.fallback` を使用(本会話は続行)
  - **どのケースでも本会話の Sonnet 呼び出しは継続する**
- **キャッシュ**:直近10件の判定結果を保持(同一クエリの再判定を回避)

#### タイムアウト実装

```typescript
// 実装方針(疑似コード)

async function classify(userText, knowledgeDomains): Promise<RoutingResult> {
  const cached = cache.get(userText);
  if (cached) return cached;

  try {
    const result = await Promise.race([
      callHaiku(userText, knowledgeDomains),
      timeout(800),  // 800ms で reject
    ]);
    cache.set(userText, result);
    return result;
  } catch (e) {
    // タイムアウト or API失敗 → fallback で継続(ユーザーには見せない)
    log.warn("Knowledge Router timeout/failure, using fallback", e);
    return buildFallback(knowledgeDomains);
  }
}
```

#### キャッシュ仕様

```typescript
// src/router/cache.ts
interface CacheEntry {
  query: string;          // 正規化済みクエリ
  result: RoutingResult;
  timestamp: number;
}

// LRU方式、最大10件、TTLなし(セッション内のみ)
```

### 3.3 Memory Layer

#### 責務
- 3層記憶(短期・中期・長期)の管理
- MVPではタグベース検索のみ
- 会話終了時の記憶抽出と保存

#### 主要型定義

```typescript
// src/shared/types/memory.ts

export interface ShortTermEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  extracted: boolean;        // 中期記憶への抽出済みフラグ(重複抽出防止)
}

export interface EpisodicMemory {
  date: string;              // ISO 8601
  topic: string;
  summary: string;
  tags: string[];
  importance: number;        // 1-5(必須・将来の忘却機構で参照される)
  category: string;          // health, work, hobby など
}

export interface SemanticMemory {
  // === コアフィールド(スキーマ検証対象・型不一致なら拒否) ===
  version: number;                    // スキーマバージョン(MVPは 1)
  userName?: string;
  preferences?: Record<string, string>;
  longTermGoals?: string[];
  personality?: string[];

  // === 拡張領域(LLMが自由に追記可能・構造のみ検証) ===
  // ENEが「ユーザーの新しい性格特性に気づいた」等を保存できる
  // 値の型は string / string[] / number / boolean に限定する
  extra?: Record<string, ExtraValue>;
}

// extra に許容する値の型(過度な複雑さを避ける)
export type ExtraValue = string | string[] | number | boolean;

export interface MemoryContext {
  shortTerm: ShortTermEntry[];
  semantic: SemanticMemory;
  episodic: EpisodicMemory[];
}

export interface SearchQuery {
  tags?: string[];
  category?: string;
  minImportance?: number;
  fromDate?: string;
  limit?: number;            // デフォルト 5
}
```

#### 主要関数

```typescript
// src/memory/short-term.ts
export function getShortTerm(): Promise<ShortTermEntry[]>;
export function appendShortTerm(entry: ShortTermEntry): Promise<void>;
export function trimShortTerm(maxEntries: number): Promise<void>;

// src/memory/episodic.ts
export function saveEpisodic(memory: EpisodicMemory): Promise<void>;
export function searchEpisodic(query: SearchQuery): Promise<EpisodicMemory[]>;

// src/memory/semantic.ts
export function getSemantic(): Promise<SemanticMemory>;
export function updateSemantic(patch: Partial<SemanticMemory>): Promise<void>;

// src/memory/extractor.ts
// 引数は「未抽出のエントリ」のみを渡すこと(extracted: false のもの)
// 呼出側で extracted フラグをチェックしてフィルタしてから渡す
export async function extractMemoryFromConversation(
  unextractedEntries: ShortTermEntry[]
): Promise<{
  episodic?: EpisodicMemory;
  semanticPatch?: Partial<SemanticMemory>;
}>;
```

#### MVP実装方針(タグ検索 + 全ファイル走査)

- 全Episodic Memoryファイルを走査
- タグ・カテゴリ・重要度・日付でフィルタ
- 上位 `limit` 件を返す

#### スケール想定と限界

ビジョン§3 柱1「人間らしい忘却」の実装(将来拡張)を前提として、
MVPの全ファイル走査でも実用上のスケール限界に達しない設計とする。

| 期間 | 想定ファイル数 | 全ファイル走査の所要時間 | MVP実用性 |
|------|---------------|------------------------|----------|
| 1ヶ月 | 約100件 | 約10ms | ◎ |
| 1年 | 約2,000件 | 約100ms | ◎ |
| 3年 | 約6,000件 | 約300〜500ms | ○ |
| 5年 | 約10,000件 | 約500ms〜1秒 | △(忘却機構の導入推奨) |
| 10年 | 約20,000件 | 約1〜2秒 | ✕(忘却機構が必須) |

**算定根拠**:1日3セッション × 1セッション平均2件抽出 = 1日6件、年間約2,000件。

**MVP方針**:全ファイル走査で **3年規模** までは実用可能。それ以降は
ビジョン由来の本質的対策(**忘却機構の実装**)を将来拡張で導入する(§11.6参照)。

> 📌 **設計判断**:「インデックスファイル方式」「ベクトル検索」などで
> 全データ高速化する方向ではなく、**忘却機構で総量自体を抑える方向**を採る。
> これはビジョン§3 柱1「人間らしい忘却」と整合する根本的な対策である。

#### 短期記憶の保持と抽出トリガ

- 直近 **20件**(user/assistant合計)を保持
- 各エントリは `extracted: boolean` フラグを持つ
- **抽出トリガは2つ**:
  1. 短期記憶が20件を超過した時(古いエントリ削除前)
  2. アプリ終了時(セッション総括)
- **重複防止**:抽出処理は `extracted: false` のエントリのみを対象とする
- 抽出に使ったエントリは `extracted: true` に更新する
- 既に `extracted: true` のエントリは再抽出されない

```typescript
// 抽出処理の方針(疑似コード)

async function extractFromShortTerm(reason: "overflow" | "shutdown"): Promise<void> {
  const shortTerm = await getShortTerm();
  const unextracted = shortTerm.filter((e) => !e.extracted);

  if (unextracted.length === 0) return;  // 抽出対象なし

  const result = await extractMemoryFromConversation(unextracted);

  if (result.episodic) {
    await saveEpisodic(result.episodic);
  }
  if (result.semanticPatch) {
    await updateSemantic(result.semanticPatch);
  }

  // 抽出に使ったエントリにフラグを立てる
  unextracted.forEach((e) => { e.extracted = true; });
  await saveShortTerm(shortTerm);
}
```

#### SemanticMemory のスキーマ検証方針

`SemanticMemory` は「コアフィールド」と「拡張領域 (`extra`)」の2層構造を持つ。
それぞれ検証方針が異なる。

**コアフィールドの検証**(厳密):
- `version` は必須・number 型
- `userName` 等の既知フィールドは、定義された型と一致すること
- 型不一致なら拒否(ログに警告)し、当該フィールドを無視

**`extra` 領域の検証**(構造のみ):
- `extra` がオブジェクトであること
- 各値が `ExtraValue` 型(string / string[] / number / boolean)のいずれか
- 中身の意味は問わない(LLMが勝手に追記した内容を尊重)
- 型不一致のキーは個別に無視(全体を捨てない)

```typescript
// 検証ロジックの方針(疑似コード)

function validateSemanticMemory(raw: unknown): SemanticMemory {
  if (typeof raw !== "object" || raw === null) {
    return { version: 1 };  // 空のデフォルトを返す
  }

  const result: SemanticMemory = { version: 1 };

  // コアフィールドを型ガードで個別に検証
  if (typeof (raw as any).userName === "string") {
    result.userName = (raw as any).userName;
  }
  // ... (他のコアフィールドも同様)

  // extra 領域は構造のみ検証
  if (typeof (raw as any).extra === "object" && (raw as any).extra !== null) {
    const validExtra: Record<string, ExtraValue> = {};
    for (const [key, value] of Object.entries((raw as any).extra)) {
      if (isExtraValue(value)) {
        validExtra[key] = value;
      }
      // 型違反のキーは個別に無視(全体は壊さない)
    }
    if (Object.keys(validExtra).length > 0) {
      result.extra = validExtra;
    }
  }

  return result;
}

function isExtraValue(v: unknown): v is ExtraValue {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    (Array.isArray(v) && v.every((x) => typeof x === "string"))
  );
}
```

これにより、CLAUDE.md §7.3「Claude API応答のJSONは必ずスキーマ検証してから使う」
の要件を、自由度を保ったまま満たせる。

### 3.4 Conversation Layer

#### 責務
- Character Context + Memory Context + ユーザー入力を統合
- Claude API呼出
- JSON応答のパース・検証

#### 主要型定義

```typescript
// src/shared/types/conversation.ts

export type ResponseType = "chat" | "os_command";

export interface ChatResponse {
  type: "chat";
  message: string;
}

export interface OsCommandResponse {
  type: "os_command";
  message: string;            // キャラとしての応答も付随
  command: OsCommand;         // src/shared/types/os.ts で定義(action は固定リテラル型)
}

export type ConversationResponse = ChatResponse | OsCommandResponse;
```

> 📌 `OsCommand` の action は `"open_notepad" | "open_browser" | "open_folder"` の
> リテラル型に固定されている(§3.5 参照)。これにより、Claude APIが想定外の
> action 文字列を返しても、応答パース時の型ガードで即座に検出・拒否できる。

#### Claude APIの使用方針

- **モデル**:`claude-sonnet-4-6`(品質と速度のバランス)
- **max_tokens**:1024
- **temperature**:**0.7**(キャラの自然さと JSON 安定性のバランス)
- **system**:CharacterContextから構築
- **messages**:Few-shot + Memory要約 + 直近の短期記憶 + 現在の入力
- **Prefill**:assistant メッセージとして `{` を末尾に追加し、応答が必ず JSON で始まるよう強制

#### 入力トークンの上限管理

Claude Sonnet のコンテキストウィンドウは大きいが、入力トークンには課金され、
応答速度にも影響する。MVPでは以下のターゲットを設定する。

| 指標 | 値 | 措置 |
|------|------|------|
| 推奨ターゲット | 20K トークン以下 | 通常運用の目安 |
| 警告上限 | 25K トークン | この値を超えたら警告ログ |
| 絶対上限 | 50K トークン | これを超える要求は拒否 |

各記憶要素の制限:

| 要素 | MVP上限 |
|------|--------|
| Semantic Memory | 約3K トークン(超過時は要約処理・MVPはそのまま使用) |
| Episodic Memory(検索結果) | **最大5件** に制限(F-MEM-F-05) |
| Episodic Memory の summary 1件 | 200文字以内を目安(extractor 側で制御) |
| Short-term Memory | 直近20件・合計5K トークン以下を目安 |
| Few-shot | 該当ドメインから1〜3例(増やしすぎない) |

#### トークン数計測の実装方針

リクエスト前にトークン数を計測し、上限超過時にログ・警告を出す。

```typescript
// src/conversation/token-counter.ts(実装方針)

const TOKEN_TARGET = 20_000;
const TOKEN_WARN_LIMIT = 25_000;
const TOKEN_HARD_LIMIT = 50_000;

export async function countAndCheck(
  client: Anthropic,
  request: MessageCreateParams
): Promise<{ ok: boolean; tokens: number; reason?: "warn" | "hard_limit" }> {
  // Anthropic SDK の token counting API でカウント
  const { input_tokens } = await client.messages.countTokens(request);

  if (input_tokens > TOKEN_HARD_LIMIT) {
    return { ok: false, tokens: input_tokens, reason: "hard_limit" };
  }
  if (input_tokens > TOKEN_WARN_LIMIT) {
    log.warn(`Input tokens (${input_tokens}) exceed warning limit`);
    return { ok: true, tokens: input_tokens, reason: "warn" };
  }
  return { ok: true, tokens: input_tokens };
}
```

絶対上限(50K)を超えた場合は、Episodic Memory の検索結果を段階的に
削減してリトライする(将来拡張・MVPでは超過時にエラー応答)。

#### JSON出力強制の実装方針(Prefill 方式)

Claude API は assistant メッセージで応答開始を「先回り」できる(Prefill)。
これを利用し、応答が必ず `{` から始まるよう強制する。これにより、
高 temperature 設定でも JSON 崩れを防げる。

```typescript
// 実装方針(疑似コード)

const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  temperature: 0.7,
  system: systemPrompt,
  messages: [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: "{" }  // ← Prefill
  ],
});

// 応答先頭の "{" は API レスポンスには含まれないため、補完する
const rawJson = "{" + extractText(response);
```

#### プロンプト構築テンプレート

```typescript
// src/conversation/prompt-builder.ts

export function buildPrompt(
  charContext: CharacterContext,
  memoryContext: MemoryContext,
  userText: string
): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};
```

System Promptの構造:
```
{charContext.systemPrompt}

# あなたの長期的な記憶
{memoryContext.semantic を要約}

# 関連する過去の出来事
{memoryContext.episodic を箇条書き}

# 今日の特別な情報
{charContext.birthdayHint があれば}

# 出力形式(厳守)
以下のJSON形式のいずれかで応答してください。

通常の会話:
{"type": "chat", "message": "..."}

OS操作(以下の3種類のみ。それ以外の action は使えない):

メモ帳を開く:
{"type": "os_command", "message": "...", "command": {"action": "open_notepad"}}

ブラウザでURLを開く(http/https のみ):
{"type": "os_command", "message": "...", "command": {"action": "open_browser", "target": "https://..."}}

フォルダをエクスプローラで開く(ユーザーホーム配下のみ、絶対パス):
{"type": "os_command", "message": "...", "command": {"action": "open_folder", "target": "C:\\Users\\..."}}

ユーザーが上記以外の操作を求めた場合は、chat 型で「それはできない」と
キャラ口調で説明してください。
```

#### 応答パースの堅牢化

Prefill により大半のケースで正しい JSON が返るが、稀な崩れに備えて
パース処理に救済ロジックを入れる。

```typescript
// src/conversation/response-parser.ts(実装方針)

export function parseConversationResponse(raw: string): ConversationResponse {
  let text = raw.trim();

  // 1. ```json ... ``` のコードフェンスを除去(Claudeが付ける可能性)
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  // 2. JSONの開始括弧から終了括弧までを抽出
  //    (前後にテキストが混入していても救済)
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    return fallbackResponse();
  }
  text = text.slice(firstBrace, lastBrace + 1);

  // 3. パースと型ガード検証
  try {
    const parsed = JSON.parse(text);
    if (isValidResponse(parsed)) {
      return parsed;
    }
    return fallbackResponse();
  } catch {
    return fallbackResponse();
  }
}

function fallbackResponse(): ConversationResponse {
  return { type: "chat", message: "…ごめん、なんか調子悪いみたい。もう一回試してみて?" };
}

function isValidResponse(obj: unknown): obj is ConversationResponse {
  // 手書きの型ガード(zod等は使わない)
  // type が "chat" / "os_command" のいずれか
  // os_command の場合は command.action が許可リテラルか
  // ... (省略)
}
```

#### パース成功率の三段構え

| 段階 | 対応するケース |
|------|--------------|
| 1段目:Prefill 強制 | 99%以上のケースで先頭から正しい JSON |
| 2段目:フェンス除去 | Claudeが ```json``` で囲んだケース |
| 3段目:JSON 範囲抽出 | 前後にテキスト混入したケース |
| 失敗時:フォールバック | 完全に崩れた場合のキャラ口調エラー応答 |

#### AI自称防止の4層防御(ビジョン§3 柱2 / 成功基準8 を担保)

ビジョンの中核「AIっぽくない」を技術的に担保する仕組み。
キャラが「私はAIなので」「アシスタントとして」のような自称をすると、
**プロダクトの本質が崩壊する**。複数の防御層で構造的に防ぐ。

##### 防御層の構成

```
ユーザー入力
   ↓
[第1防御] プロンプト強化
   ├─ System Prompt に identity.json の neverCallsSelf を明示
   └─ Few-shot に「AIかと問われた時の応答」を含める
   ↓
Claude API 呼出 → 応答取得
   ↓
JSON パース(三段構え)
   ↓
[第2防御] AI自称検知
   ├─ chat.message 内に neverCallsSelf の語が含まれるか走査
   ├─ 検知パターン:「私はAI」「自分はアシスタント」「AIとして」等
   └─ クリーン → ユーザーに表示
   ↓ (検知された場合)
[第3防御] 再生成1回
   ├─ システム指示を強化して再リクエスト
   ├─ 「前回の応答に NG ワードが含まれていました。ENEとして応答し直して」
   └─ 再パース → 再検知 → クリーンならユーザーに表示
   ↓ (再生成でもNGの場合)
[第4防御] フォールバック応答
   └─ キャラ口調の安全な応答に置換
       例:「えっと…うまく言葉が出ないみたい。もう一回聞いてくれる?」
```

##### 検知ロジックの実装方針

```typescript
// src/conversation/ai-self-check.ts(実装方針)

export interface AiSelfCheckResult {
  detected: boolean;
  matchedWord?: string;
  matchedPattern?: string;
}

export function detectAiSelfReference(
  text: string,
  neverCallsSelf: string[]
): AiSelfCheckResult {
  // identity.json の neverCallsSelf 配列(例: ["AI", "アシスタント", "モデル", "プログラム"])
  for (const word of neverCallsSelf) {
    // 「私はAI」「自分はAIで」のような自称パターンを検知
    const patterns = [
      `私は${word}`,    `私が${word}`,
      `自分は${word}`,  `自分が${word}`,
      `${word}として`,  `${word}なので`,
      `${word}ですが`,  `${word}には`,
    ];
    for (const pat of patterns) {
      if (text.includes(pat)) {
        return { detected: true, matchedWord: word, matchedPattern: pat };
      }
    }
  }
  return { detected: false };
}
```

##### Conversation Layer の統合フロー

```typescript
// src/conversation/client.ts(疑似コード)

async function chat(userText: string): Promise<ConversationResponse> {
  // 第1防御:プロンプトに neverCallsSelf を含める(buildPrompt 内で実施)
  const prompt = buildPrompt(charContext, memoryContext, userText);

  // 通常リクエスト
  let response = await callClaudeAndParse(prompt);

  // 第2防御:AI自称検知
  if (response.type === "chat") {
    const check = detectAiSelfReference(
      response.message,
      charContext.identity.selfRecognition.neverCallsSelf
    );

    if (check.detected) {
      log.warn(`AI self-reference detected: ${check.matchedPattern}`);

      // 第3防御:再生成1回
      const strengthened = addRegenerationHint(prompt, check);
      response = await callClaudeAndParse(strengthened);

      // 再検知
      if (response.type === "chat") {
        const recheck = detectAiSelfReference(
          response.message,
          charContext.identity.selfRecognition.neverCallsSelf
        );

        if (recheck.detected) {
          // 第4防御:フォールバック
          log.error("AI self-reference still detected after regeneration");
          return fallbackResponse();
        }
      }
    }
  }

  return response;
}
```

##### 各層の役割

| 層 | 目的 | 想定捕捉率 | コスト |
|----|------|----------|------|
| 第1防御(プロンプト) | 最初から出させない | 99% | ゼロ |
| 第2防御(検知) | 漏れたものを発見 | 99% を 99.99% に | ほぼゼロ |
| 第3防御(再生成) | 修正の機会を与える | 99.99% を 99.999% に | API呼出1回追加 |
| 第4防御(フォールバック) | 最終安全網 | 残り全部 | ゼロ |

##### 設計上の注意

- 検知ロジックは**コンパクトに保つ**(過剰な NG ワード追加で誤検知しない)
- `neverCallsSelf` は キャラごとに `identity.json` で定義(ハードコードしない)
- 検知パターン(`私は{word}` 等)はキャラ非依存(コードに定義)
- フォールバック応答もキャラ口調で書く(キャラの世界観を保つ)

### 3.5 OS Integration Layer

#### 責務
- ホワイトリスト方式のコマンド実行(action と target の両方を検証)
- Electron `shell` API を用いた安全な実行
- ユーザーホームディレクトリ配下に限定したパスアクセス

#### 主要型定義

```typescript
// src/shared/types/os.ts

// MVPで対応する action は固定の3種類のみ
export type OsAction =
  | "open_notepad"   // メモ帳を起動(空文書)
  | "open_browser"   // 既定ブラウザでURLを開く
  | "open_folder";   // エクスプローラでフォルダを開く

export interface OsCommand {
  action: OsAction;
  target?: string;   // open_browser: URL / open_folder: パス / open_notepad: 不要
}

export interface OsCommandResult {
  success: boolean;
  message?: string;  // ユーザーに見せるキャラ口調のメッセージ
  error?: string;    // ログ用の技術的エラー(ユーザーには見せない)
}
```

#### action と target のマッピング表

Claude API が返す `os_command` の action / target は、以下のマッピングに従う。
これ以外の組合せは即座に拒否する。

| action | target の意味 | 必須/任意 | 検証ルール |
|--------|--------------|----------|----------|
| `open_notepad` | なし | 不要(あっても無視) | — |
| `open_browser` | 開きたいURL | 必須 | http:// または https:// のみ許可 |
| `open_folder` | 開きたいフォルダの絶対パス | 必須 | ユーザーホーム配下のみ許可 |

#### ホワイトリスト・検証ロジック

```typescript
// src/os/whitelist.ts

import { homedir } from "node:os";
import path from "node:path";

export const ALLOWED_ACTIONS: readonly OsAction[] = [
  "open_notepad",
  "open_browser",
  "open_folder",
] as const;

// URL検証: http/httpsのみ許可
export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// パス検証: ユーザーホームディレクトリ配下のみ許可
export function isAllowedFolderPath(targetPath: string): boolean {
  try {
    const home = path.resolve(homedir());
    const resolved = path.resolve(targetPath);

    // パス境界チェック(homedirのサブパスであること)
    const relative = path.relative(home, resolved);

    // 親ディレクトリへの脱出(..を含む)・絶対パスを拒否
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
```

#### 実装方針(Electron `shell` API 採用)

`child_process.spawn` ではなく Electron 公式の `shell` API を使用する。
これにより `start` コマンド問題・シェルインジェクションリスクを根本的に回避する。

```typescript
// src/os/executor.ts

import { shell } from "electron";
import { spawn } from "node:child_process";
import { isAllowedUrl, isAllowedFolderPath } from "./whitelist";

export async function execute(cmd: OsCommand): Promise<OsCommandResult> {
  switch (cmd.action) {
    case "open_notepad":
      // メモ帳は引数なしで起動(MVPでは空文書のみ)
      // spawnは引数配列固定で安全
      spawn("notepad.exe", [], { detached: true, stdio: "ignore" }).unref();
      return { success: true, message: "メモ帳を開いたわよ。" };

    case "open_browser":
      if (!cmd.target || !isAllowedUrl(cmd.target)) {
        return { success: false, error: "Invalid or disallowed URL" };
      }
      // shell.openExternal: OS既定のブラウザで安全に開く
      await shell.openExternal(cmd.target);
      return { success: true, message: "ブラウザで開いたわよ。" };

    case "open_folder":
      if (!cmd.target || !isAllowedFolderPath(cmd.target)) {
        return { success: false, error: "Disallowed path (must be under user home)" };
      }
      // shell.openPath: OS既定のファイラ(エクスプローラ等)で安全に開く
      const errorMessage = await shell.openPath(cmd.target);
      if (errorMessage) {
        return { success: false, error: errorMessage };
      }
      return { success: true, message: "フォルダを開いたわよ。" };

    default:
      // TypeScriptの網羅性チェックでビルド時に検知される
      const _exhaustive: never = cmd.action;
      return { success: false, error: "Unknown action" };
  }
}
```

#### セキュリティ設計の根拠

| リスク | 対策 |
|--------|------|
| シェルインジェクション | `shell` APIは内部でOS安全API(ShellExecuteW等)を使用。シェル経由しない |
| 任意コマンド実行 | action は型レベルで3種類に固定(`OsAction` リテラル型) |
| 任意URL誘導(フィッシング助長) | http/https のみ許可。`javascript:`、`file:`、`smb:` 等を拒否 |
| パストラバーサル | `path.relative` で境界チェック。`..` を含むパスを拒否 |
| ユーザーホーム外アクセス | ホームディレクトリ配下に限定。`C:\Windows` 等を防ぐ |
| `notepad.exe` 偽装 | 引数なし固定のため、コマンドラインからファイルを開かれない |

#### キャラ応答との統合

`OsCommandResult.message` はキャラ口調の文字列を含むが、これは
**Conversation Layer が既に応答 JSON 内に `message` を含めている**ため、
通常はそちらを優先表示する。`OsCommandResult.message` は実行失敗時の
フォールバック用途として使用する。

### 3.6 Storage Layer

#### 責務
- ファイルパスの統一管理(ポータブル領域とマシン固定領域を区別)
- APIキーの暗号化保存・復号(safeStorage経由)
- 平文JSONファイルの読み書き

#### 主要関数

```typescript
// src/storage/paths.ts

// ポータブルデータ(exeと同じディレクトリの data/)
export function getPortableDataDir(): string;     // (exeディレクトリ)/data/

// 記憶関連(現在の active キャラに依存)
// これらの関数は active-character.json の characterId を参照して動的にパスを返す
export function getMemoryDir(): string;            // data/memory/{activeCharId}/
export function getEpisodicDir(year: number, category: string): string;
                                                   // data/memory/{activeCharId}/episodic/{year}/{category}/
export function getSemanticPath(): string;        // data/memory/{activeCharId}/semantic.json
export function getShortTermPath(): string;       // data/memory/{activeCharId}/short-term.json

// キャラ運用状態関連(active キャラに依存しない・常に固定パス)
export function getActiveCharacterPath(): string; // data/config/active-character.json

// その他のポータブルデータ
export function getLogsDir(): string;              // data/logs/(アプリ動作ログ・PII含めない)
export function getWindowPositionPath(): string;  // data/config/window-position.json

// マシン固定データ(%APPDATA%/ene-desktop/)
export function getMachineDataDir(): string;      // app.getPath('userData')
export function getApiKeyPath(): string;          // %APPDATA%/ene-desktop/api-key.enc

// src/storage/encryption.ts (APIキー専用)
export function encryptAndSaveApiKey(plaintext: string): Promise<void>;
export function loadAndDecryptApiKey(): Promise<string | null>;
export function isApiKeyAvailable(): Promise<boolean>;

// src/storage/json-store.ts (平文JSON操作)
export async function readJson<T>(path: string): Promise<T | null>;
export async function writeJson<T>(path: string, data: T): Promise<void>;
export async function listJsonFiles(dir: string): Promise<string[]>;
```

> 📌 **設計判断**:記憶パス関数は `active-character.json` を参照して動的に
> パスを返す。これにより Memory Layer のロジック自体はキャラを意識せずに動作する
> (キャラ切替が Memory Layer に影響しない疎結合構造)。

#### APIキー保存(部分暗号化方式)

- Electron `safeStorage.encryptString()` で暗号化
- 暗号化済みバイト列を `%APPDATA%/ene-desktop/api-key.enc` に保存
  - パスは `app.getPath('userData')` で取得(Electron標準API)
  - `data/` 配下には**置かない**(別PCで復号不可になるため)
- 起動時に `safeStorage.isEncryptionAvailable()` で利用可能性を確認
- 利用不可なら(古いLinux等)、エラーダイアログで起動中止
- 環境変数 `ANTHROPIC_API_KEY` での上書きは**開発ビルド時のみ許容**
  - 本番ビルド(`NODE_ENV=production`)では環境変数を読まない

#### 記憶ファイルの保存

- すべて **平文JSON** で `data/memory/{characterId}/` 配下に保存
- 暗号化処理は通さない(可読性・可搬性のため)
- ユーザーが直接 `data/memory/{characterId}/semantic.json` を開いて中身を確認できる

#### 会話の逐語ログは保存しない

- ユーザーの会話内容を逐語的に記録するログ機能は**実装しない**
- 過去の会話を辿る用途は、中期記憶(Episodic Memory)の `summary` で代替する
- ビジョン§3 柱1「全会話ログを保持しない・人間らしい忘却」と整合する

#### アプリ動作ログ(`electron-log`)の方針

- `data/logs/` には `electron-log` が出力するアプリ動作ログのみを保存
- 記録対象は**メタ情報のみ**:起動・終了・エラー種別・API応答時間・Router判定結果など
- 以下は**ログに含めない**(個人情報保護):
  - ユーザー入力テキストの全文
  - AI応答テキストの全文
  - プロンプト全文(System Prompt・Memory Context等)
  - Semantic / Episodic Memory の内容

#### 開発時と本番時のパス解決

`getPortableDataDir()` は実行環境に応じて返値を切り替える。
Electron の `app.isPackaged` プロパティで判定する。

```typescript
// src/storage/paths.ts(実装方針)

import { app } from "electron";
import path from "node:path";

export function getPortableDataDir(): string {
  if (app.isPackaged) {
    // 本番(exe実行時):exeと同じディレクトリの data/
    // 例: C:\Users\username\Desktop\ENE\data\
    return path.join(path.dirname(process.execPath), "data");
  } else {
    // 開発(npm run dev時):プロジェクトルートの data/
    // 例: <repo>/data/
    return path.join(process.cwd(), "data");
  }
}
```

| 環境 | `getPortableDataDir()` の返値 | 備考 |
|------|------------------------------|------|
| 本番(`app.isPackaged === true`) | `path.dirname(process.execPath) + /data` | exeの隣に作成 |
| 開発(`app.isPackaged === false`) | `process.cwd() + /data` | リポジトリルートに作成 |

開発時に作られる `data/` は `.gitignore` に含まれるため、リポジトリには
コミットされない(設計書 §2 のディレクトリ構成を参照)。

なお、マシン固定データ用の `getMachineDataDir()` は環境を問わず
`app.getPath('userData')` を使う。Electronが自動的に開発時と本番時で
適切な場所(`%APPDATA%/ene-desktop/`)を返す。

### 3.7 APIキー管理ダイアログ(API Key Management)

#### 責務
- 初回起動時のAPIキー入力UI提供
- 入力されたキーの形式バリデーションと疎通テスト
- ユーザーがキーを後から変更する手段の提供
- Anthropic API キー取得手順のユーザー案内(I17)

#### 表示タイミング

1. **初回起動時**:`%APPDATA%/ene-desktop/api-key.enc` が存在しない時
2. **キー失効時**:既存キーで疎通失敗した時(認証エラー検知時)
3. **ユーザー任意操作時**:キャラ右クリックメニューの「APIキーを設定...」選択時

#### ダイアログ UI(モックアップ)

```
┌──────────────────────────────────────────────────┐
│  ENE をはじめる準備                                │
│                                                   │
│  ENE と会話するには、Anthropic の API キーが必要  │
│  です。                                            │
│                                                   │
│  ▶ Anthropic Console を開く  [外部リンクボタン]  │
│                                                   │
│  取得手順:                                         │
│  1. Anthropic Console にサインアップ              │
│  2. 「API Keys」から新しいキーを作成              │
│  3. 利用にはクレジット購入が必要(無料枠あり)     │
│  4. 作成したキー(sk-ant-...)を下に貼り付け       │
│                                                   │
│  API キー: [_______________________] [接続テスト] │
│  状態:     (未入力 / 検証中... / ✓成功 / ✗失敗) │
│                                                   │
│  ※ キーはあなたのPC内に暗号化保存されます         │
│  ※ Anthropic 以外には送信しません                 │
│                                                   │
│                       [キャンセル]  [保存して始める]│
└──────────────────────────────────────────────────┘
```

#### バリデーションの3段階

```typescript
// src/main/api-key-dialog.ts(実装方針)

// 段階1: 入力時の即時形式チェック(同期)
function isValidKeyFormat(key: string): boolean {
  return key.startsWith("sk-ant-") && key.length >= 50;
}

// 段階2: 疎通テスト(「接続テスト」ボタン または「保存」前に自動実行)
type PingResult =
  | { ok: true }
  | { ok: false; reason: "auth" | "credit" | "network" | "other"; detail?: string };

async function testApiKey(key: string): Promise<PingResult> {
  try {
    const client = new Anthropic({ apiKey: key });
    await client.messages.create({
      model: "claude-haiku-4-5-20251001",   // 軽量モデルで最小コスト
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true };
  } catch (e: any) {
    if (e.status === 401) return { ok: false, reason: "auth" };
    if (e.status === 402 || e.status === 429) return { ok: false, reason: "credit" };
    if (e.code === "ENOTFOUND" || e.code === "ETIMEDOUT") return { ok: false, reason: "network" };
    return { ok: false, reason: "other", detail: String(e) };
  }
}

// 段階3: 保存(疎通成功時のみ実行)
async function saveAndPersist(key: string): Promise<void> {
  await encryptAndSaveApiKey(key);
}
```

#### エラー種別ごとのユーザー表示

| 検知エラー | ダイアログ表示メッセージ |
|----------|----------------------|
| `auth` (401) | 「APIキーが無効です。コピー漏れがないか確認してください。」 |
| `credit` (402/429) | 「クレジット残高が不足しているか、レート上限に達しています。Anthropic Console で確認してください。」 |
| `network` | 「Anthropic に接続できませんでした。インターネット接続を確認してください。」 |
| `other` | 「予期しないエラーが発生しました:{詳細}」 |

#### 後から変更する手段

§8.5 で定義したキャラ右クリックメニューに「APIキーを設定...」項目を追加する。

```
キャラ上で右クリック:
├─ 話す
├─ ─────────────
├─ 位置をリセット
├─ APIキーを設定...      ← 本ダイアログを再度開く
├─ ─────────────
└─ じゃあね...
```

#### 設計上の注意

- ダイアログは Electron `BrowserWindow` で実装(モーダルとして表示)
- キーの入力欄は **マスク表示**(`type="password"`)とする
- 「Anthropic Console を開く」ボタンは `shell.openExternal("https://console.anthropic.com/")` を呼ぶ
- APIキーは平文のままメモリにも長時間保持せず、Anthropic SDK のインスタンスを通じてのみ使用する

---

## 4. IPC通信設計

### 4.1 設計原則

- 全IPCは**型定義された契約**として `src/shared/types/ipc.ts` に集約
- Renderer → Main は `ipcRenderer.invoke` を使用(Promise返却)
- Main → Renderer は `webContents.send` でイベント通知
- Preloadスクリプトで `contextBridge.exposeInMainWorld` を使い、
  Renderer側に安全なAPIを公開

### 4.2 IPCチャンネル定義

```typescript
// src/shared/types/ipc.ts

export interface EneAPI {
  // 会話関連
  sendMessage(text: string): Promise<ConversationResponse>;
  
  // キャラクター関連
  getCharacterInfo(): Promise<{
    name: string;
    portraitPath: string;
  }>;
  
  // 設定関連
  hasApiKey(): Promise<boolean>;
  saveApiKey(key: string): Promise<void>;
  
  // ウィンドウ操作
  moveWindow(x: number, y: number): Promise<void>;
  resetWindowPosition(): Promise<void>;
  setIgnoreMouseEvents(ignore: boolean): Promise<void>;  // クリックスルー制御(§8.6)

  // キャラ右クリックメニュー(main process側でネイティブメニューを表示)
  showCharacterContextMenu(): Promise<void>;

  // ライフサイクル
  onAppReady(callback: () => void): void;
  onError(callback: (error: string) => void): void;

  // タスクトレイ/コンテキストメニューからのイベント受信(main → renderer)
  onOpenInputArea(callback: () => void): void;       // 「ENEと話す」「話す」選択時
  onResetPosition(callback: () => void): void;       // 「位置をリセット」選択時
}

// Renderer側で window.ene.sendMessage(...) のように使う
declare global {
  interface Window {
    ene: EneAPI;
  }
}
```

### 4.3 Preloadスクリプト

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";

const eneAPI: EneAPI = {
  sendMessage: (text) => ipcRenderer.invoke("ene:send-message", text),
  getCharacterInfo: () => ipcRenderer.invoke("ene:get-character-info"),
  hasApiKey: () => ipcRenderer.invoke("ene:has-api-key"),
  saveApiKey: (key) => ipcRenderer.invoke("ene:save-api-key", key),
  moveWindow: (x, y) => ipcRenderer.invoke("ene:move-window", x, y),
  resetWindowPosition: () => ipcRenderer.invoke("ene:reset-window-position"),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke("ene:set-ignore-mouse-events", ignore),
  showCharacterContextMenu: () => ipcRenderer.invoke("ene:show-character-context-menu"),
  onAppReady: (cb) => ipcRenderer.on("ene:app-ready", cb),
  onError: (cb) => ipcRenderer.on("ene:error", (_, error) => cb(error)),
  onOpenInputArea: (cb) => ipcRenderer.on("ene:open-input-area", cb),
  onResetPosition: (cb) => ipcRenderer.on("ene:reset-position", cb),
};

contextBridge.exposeInMainWorld("ene", eneAPI);
```

### 4.4 セキュリティ設定

```typescript
// src/main/window.ts
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,         // 必須
    contextIsolation: true,         // 必須
    sandbox: true,                  // 推奨
    preload: path.join(__dirname, "../preload/index.js"),
  },
  // 透過ウィンドウ設定
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  resizable: false,
  hasShadow: false,
});
```

---

## 5. データスキーマ詳細

### 5.1 キャラクタープロファイル(4ファイル)

キャラクター定義の完全なJSONサンプル(identity / background /
knowledge_domains / fewshot)は、別添資料を参照すること。

> 📎 **別添 A:キャラクタープロファイル JSON サンプル集**
> ファイル名:`A_character_profile_samples.md`
> 内容:
> - A.1 `identity.json` 完全形
> - A.2 `background.json` 完全形
> - A.3 `knowledge_domains.json` 完全形(5段階ドメインのトピック例付き)
> - A.4 `fewshot.json` 完全形(各ドメインの応答例 + 誕生日反応)
> - A.5 portrait.png の仕様
> - A.6 配置場所まとめ

各ファイルの型定義は §3.1「Character Layer」を参照。

### 5.2 Episodic Memory ファイル例

```
data/memory/{characterId}/episodic/2026/health/2026-05-10T17-30-00.json
```

```json
{
  "date": "2026-05-10T17:30:00+09:00",
  "topic": "健康",
  "summary": "ユーザーは最近睡眠の質を改善したいと話した。",
  "tags": ["睡眠", "健康"],
  "importance": 4,
  "category": "health"
}
```

### 5.3 ファイル命名規則

- Episodic Memory: `{ローカル日時}.json`(コロンを `-` に置換した形式・TZ省略・ユニーク化のため秒まで含む)
  - 例:`2026-05-10T17-30-00.json`(JSON 内の `date` フィールドは TZ オフセット込み)
- 階層: `data/memory/{characterId}/episodic/{year}/{category}/`
- Semantic Memory: 単一ファイル `data/memory/{characterId}/semantic.json`
- Short-term Memory: 単一ファイル `data/memory/{characterId}/short-term.json`(セッション中のみ)

### 5.4 キャラクター運用状態の管理(`active-character.json`)

現在使用中のキャラクターを示し、最小限の運用状態を記録するファイル。
**ハードコードを避け**、キャラ切替を可能にし、**誕生日機能等の最小状態を管理する**
中核ファイルとなる。

#### 保存先
`data/config/active-character.json`(ポータブルデータ)

#### スキーマ

```typescript
// src/shared/types/character.ts に追加

export interface BirthdayHistoryEntry {
  year: number;                  // 西暦
  celebrated: boolean;           // ユーザーが誕生日に触れたか
  celebratedAt?: string;         // 触れられた日時(ISO 8601)
}

export interface ActiveCharacter {
  version: number;               // スキーマバージョン(MVPは 1)
  characterId: string;           // 現在使用中のキャラID(/characters/{id}/ を参照)
  selectedAt: string;            // このキャラに切り替えた日時(ISO 8601)
  birthdayHistory: BirthdayHistoryEntry[];
  firstLaunchCompleted: boolean; // 初回起動の操作案内表示済みフラグ(§8.7)
  // 将来、他の最小状態を追加できる構造
}
```

#### サンプル

```json
{
  "version": 1,
  "characterId": "ene",
  "selectedAt": "2026-05-29T19:00:00+09:00",
  "birthdayHistory": [
    { "year": 2026, "celebrated": true, "celebratedAt": "2026-08-15T20:30:00+09:00" }
  ],
  "firstLaunchCompleted": true
}
```

#### 初回起動時の挙動
- `active-character.json` が存在しなければ、デフォルト値で生成する
  - `characterId: "ene"`(ビルド時に同梱されているキャラ)
  - `birthdayHistory: []`
  - `firstLaunchCompleted: false`(初回案内表示後に true に更新される)

#### キャラクター切替時の挙動(MVP対象外・将来拡張)
- `characterId` を変更して `selectedAt` を更新
- 記憶ディレクトリは `data/memory/{characterId}/` で自動的に分離される
- 切替UIは v2 以降で実装

#### 最小状態管理の原則
- 本ファイルは「**機能上必要な事実の記録のみ**」を保持する
- 感情パラメータ・好感度・興奮度などの**複雑な数値状態は持たない**
- 将来、新しい最小状態を追加する際は、必ず本ファイルに集約する
  (キャラごとに状態ファイルを分散させない)

### 5.5 記憶ディレクトリのキャラ別構造

ビジョン§3 柱2「キャラクター入れ替え可能性」を反映し、
**MVPから記憶ディレクトリはキャラ別に分離する**。

```
data/memory/
├── ene/                         ← ENE 専用の記憶
│   ├── short-term.json
│   ├── semantic.json
│   └── episodic/
│       └── {year}/{category}/{date}.json
└── (将来) takeshi/              ← 別キャラを追加した場合
    ├── short-term.json
    ├── ...
```

#### 設計判断の理由

- MVPは1キャラ(ENE)しか使わないが、**最初からキャラ別構造**にすることで
  将来のキャラ追加時に**破壊的変更が不要**になる
- パスが1段増えるだけで実装コストはほぼゼロ
- 「ENEもTakeshiも、ユーザーのことは共通で覚えていてほしい」というニーズが
  将来出てきた場合、`data/memory/shared/` を**追加**することで対応可能
  (既存構造を壊さない非破壊的拡張)

#### Storage Layer 関数の更新

§3.6 で定義したパス関数も、キャラ別構造に対応する。

```typescript
// src/storage/paths.ts(更新方針)

// 現在使用中キャラの記憶ディレクトリを返す
export function getMemoryDir(): string;
  // → data/memory/{activeCharacterId}/

export function getEpisodicDir(year: number, category: string): string;
  // → data/memory/{activeCharacterId}/episodic/{year}/{category}/

export function getSemanticPath(): string;
  // → data/memory/{activeCharacterId}/semantic.json

export function getShortTermPath(): string;
  // → data/memory/{activeCharacterId}/short-term.json

// active-character.json 関連
export function getActiveCharacterPath(): string;
  // → data/config/active-character.json
```

これらの関数は `active-character.json` の `characterId` を参照して
動的にパスを返す。これにより、Memory Layer のロジック自体は
キャラを意識せずに動作する(疎結合の維持)。

### 5.6 日時表現の規約

#### 採用形式:ローカルタイム + タイムゾーンオフセット

すべての日時は **ローカルタイム + タイムゾーンオフセット込みの ISO 8601 形式**で
表現する。**UTC(`Z`)表記は使わない**。

```
✓ 採用例: "2026-05-10T17:30:00+09:00"   ← 日本標準時を表す
✗ 不可:   "2026-05-10T08:30:00Z"        ← UTC表記(誕生日判定でズレる)
```

#### この方針の理由

本アプリはユーザー個人の PC で動く。ユーザーから見える時刻表現はすべて
**そのユーザーのローカルタイム**で統一する方が直感的。

- **誕生日判定**:ユーザーから見て「8月15日 0:00〜23:59 ローカル時間」が誕生日
  - UTC で `2026-08-15T00:00:00Z` を使うと、日本では「8月15日 9:00〜8月16日 8:59」がズレて誕生日扱いになる
- **記憶の日付**:「昨日話したこと」はユーザーの体感日付で記録すべき
- **ログ**:ユーザーが調査する時、ローカル時刻表記の方が即座に理解できる

#### 適用範囲

| データ | 例 |
|--------|----|
| Episodic Memory の `date` | `"2026-05-10T17:30:00+09:00"` |
| 誕生日履歴の `celebratedAt` | `"2026-08-15T20:30:00+09:00"` |
| active-character.json の `selectedAt` | `"2026-05-29T19:00:00+09:00"` |
| ファイル命名(Episodic) | `2026-05-10T17-30-00.json`(ファイル名に使えない `:` を `-` に置換、TZ省略) |
| アプリ動作ログのタイムスタンプ | electron-log のデフォルト(ローカル時刻)を採用 |

ファイル名のみ TZ を省略するのは、Windows のファイルシステム制約のため。
JSON 内のフィールドは必ず TZ オフセット込みで記録する。

#### 実装方針

`new Date().toISOString()` は UTC を返してしまうため使わない。
代わりに以下のユーティリティを用意する。

```typescript
// src/shared/datetime.ts(実装方針)

// 現在のローカル時刻を ISO 8601 + TZ オフセット形式で返す
export function nowLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const tzMin = -d.getTimezoneOffset();
  const tzSign = tzMin >= 0 ? "+" : "-";
  const tzH = pad(Math.floor(Math.abs(tzMin) / 60));
  const tzM = pad(Math.abs(tzMin) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tzSign}${tzH}:${tzM}`;
}

// ファイル名用(同じ時刻だが ":" を "-" に置換、TZ省略)
export function nowLocalIsoForFilename(): string {
  return nowLocalIso().split("+")[0].split("-").join("-").replace(/:/g, "-");
}

// ローカル日付の "今日"(YYYY-MM-DD)を取得(誕生日判定用)
export function todayLocalYmd(): { year: number; month: number; day: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}
```

> 📌 **Claude Code 向け注意**:時刻取得が必要な箇所では必ず `src/shared/datetime.ts`
> のユーティリティ関数を経由すること。直接 `new Date().toISOString()` を呼ぶことは禁止。

---

## 6. エラーハンドリング方針

### 6.1 エラーの分類と対応

| エラー種別 | 対応方針 | ユーザー表示 |
|-----------|---------|------------|
| Claude API失敗(一般) | リトライ1回、それでも失敗ならフォールバック応答 | キャラ口調で「調子悪いみたい」 |
| **Claude API認証失敗(401)** | APIキー管理ダイアログを再表示 | 「APIキーが無効です」を明示 |
| **Claude API残高/レート(402/429)** | APIキー管理ダイアログを再表示 | 「クレジット不足・レート上限」を明示 |
| **ネットワーク失敗(API疎通)** | リトライ1回、失敗ならフォールバック応答 | キャラ口調で「ネットが繋がってないみたい」 |
| Knowledge Router失敗 | fallbackドメインを使用 | 透過(ユーザーに見せない) |
| Memory読み込み失敗 | 空の記憶として続行 | 透過(ログのみ) |
| Memory書き込み失敗 | リトライせず警告ログ | 透過(次回会話で再試行) |
| OS操作失敗 | コマンド実行結果をキャラ応答に反映 | キャラ口調で報告 |
| JSON不正 | パース堅牢化(§3.4)で救済、失敗ならフォールバック | 透過(成功時) / キャラ口調(失敗時) |
| APIキー未設定 | 起動時にAPIキー管理ダイアログ表示(§3.7) | 初回セットアップを促す |

### 6.2 ログレベル

- `error`:致命的エラー(API失敗種別、ファイル破損)
- `warn`:回復可能な問題(JSON不正検知、リトライ発生)
- `info`:重要なイベント(起動、終了、キャラロード成功)
- `debug`:詳細な動作(Router判定結果のドメイン名、API応答時間など**メタ情報のみ**)

> 📌 **重要**:いずれのレベルでも、**ユーザー入力・AI応答・プロンプト全文・記憶内容
> といった個人情報は記録しない**。記録するのは「何が起きたか」のメタ情報のみ。
> 例:✓「Knowledge Router classified as 'high' in 720ms」
>     ✗「User said: '最近よく眠れない'」(これは禁止)

### 6.3 ユーザーへのエラー伝達原則

- 技術的詳細(スタックトレース等)は絶対に見せない
- 必ずキャラの口調を経由して伝える
- 例:`{ type: "chat", message: "えっと…ちょっと調子悪いみたい。もう一回試してみて?" }`

---

## 7. 起動とライフサイクル

### 7.1 起動シーケンス

```
1. Electron app起動
   ↓
2. 多重起動チェック(NEW)
   ├─ app.requestSingleInstanceLock() で排他ロック取得を試みる
   ├─ 取得失敗(既に別プロセスが起動中) → 静かに app.quit() で終了
   └─ 取得成功 → 続行
       │   ※ 2つ目の起動が試みられた時のための second-instance
       │     イベントハンドラを登録(既存ウィンドウを前面に出す)
   ↓
3. ポータブル動作の事前チェック
   ├─ getPortableDataDir() で得たパスに `data/` を作成試行
   │   (本番:exeの隣 / 開発:プロジェクトルート)
   ├─ 書込テスト(test-write.txt で書込→削除)
   ├─ 書込失敗 → エラーダイアログ「書込可能な場所に配置してください」→ 終了
   └─ 書込成功 → 続行
   ↓
4. クラウド同期フォルダ警告チェック
   ├─ パスに "OneDrive" "Dropbox" "Google Drive" 等を含むか確認
   └─ 含む場合は警告ダイアログ表示(続行は可能)
   ↓
5. APIキーの存在確認(%APPDATA%/ene-desktop/api-key.enc)
   ├─ なし → セットアップダイアログ表示
   └─ あり → 復号化してメモリ保持
   ↓
6. active-character.json の読み込み
   ├─ data/config/active-character.json を確認
   ├─ 存在しない(初回起動) → デフォルト値(characterId: "ene")で生成
   └─ characterId を取得(以降の処理で使用)
   ↓
7. キャラクタープロファイルのロード
   ├─ /characters/{characterId}/*.json を読み込み
   └─ 失敗時はエラーダイアログ表示して終了
   ↓
8. 記憶データのロード
   ├─ getMemoryDir() = data/memory/{characterId}/ から読込
   ├─ ディレクトリが存在しなければ初期化(空のキャラ別記憶領域を作成)
   └─ 短期記憶ファイルが残っていれば未抽出エントリの抽出を試みる
   ↓
9. 誕生日チェック
   ├─ active-character.json の birthdayHistory を確認
   ├─ 今日が誕生日 → "today" 状態を Character Context に反映
   ├─ 今年の誕生日が過ぎていて未祝福 → "forgotten" 状態を反映
   └─ 該当なし → 通常モード
   ↓
10. 透過ウィンドウ作成・表示
    ├─ 前回位置を復元(data/config/window-position.json)
    └─ 初回起動なら画面右下に配置
    ↓
11. 起動完了通知(Renderer)
    └─ キャラが「おかえり」等の挨拶を表示
```

#### 多重起動防止の動作詳細

Electron の `app.requestSingleInstanceLock()` を使い、同一アプリの
複数起動を防ぐ。これにより `data/short-term.json` 等の同時書き込み
による競合・破損を構造的に防ぐ。

```typescript
// src/main/index.ts(実装方針)

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // 既に別プロセスが起動している → 静かに終了
  app.quit();
} else {
  // 2つ目の起動が試みられた時のイベント
  app.on("second-instance", () => {
    // 既存のウィンドウを前面に出してユーザーに気づかせる
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  // 通常の起動処理を続行
}
```

**ユーザー体験**:
- exeを2回ダブルクリック → 2つ目は静かに終了、既存ウィンドウが前面に
- 起動済みのことに気づかず何度クリックしても、必ず1プロセスだけが残る
- エラーダイアログは表示しない(ユーザーを煩わせない設計)

### 7.2 終了シーケンス

```
1. ウィンドウクローズイベント
   ↓
2. 短期記憶から未抽出エントリ(extracted: false)のみ抽出処理
   ├─ 抽出すべき内容があれば Episodic Memory に保存
   ├─ Semantic Memory 更新があれば反映
   └─ 既に extracted: true のエントリはスキップ(重複防止)
   ↓
3. 短期記憶ファイル削除
   ↓
4. ウィンドウ位置を保存(data/config/window-position.json)
   ↓
5. ログをフラッシュ
   ↓
6. アプリ終了
```

### 7.3 異常終了対策

- 起動時に前回の短期記憶ファイルが残っていれば、未抽出エントリの抽出を試みる
- `extracted: true` のエントリは再抽出しないため、安全に再実行可能
- 抽出失敗してもアプリは起動する(記憶は失われるが動作は継続)

---

## 8. 透過ウィンドウ設計

### 8.1 ウィンドウ仕様

| 項目 | 値 |
|------|-----|
| サイズ | 240 × 320 px(キャラ部分) |
| 入力欄展開時 | 240 × 400 px |
| 透過 | true |
| フレーム | なし |
| 最前面 | 常に |
| リサイズ | 不可 |
| 影 | なし |

### 8.2 マウス操作の判別(クリック / ドラッグ / 長押し)

キャラクター上の mousedown 〜 mouseup を、移動距離と時間で3種類に判別する。
これにより「動かしたいのに入力欄が開く」「クリックしたいのに動いてしまう」
などの誤操作を防ぐ。

#### 判別フロー

```
mousedown 時:
  ├─ 開始座標 (startX, startY) を記録
  ├─ 開始時刻 startTime = Date.now() を記録
  └─ isDragging = false に初期化

mousemove 時(押下中のみ):
  ├─ 現在座標との距離 distance = sqrt((x-startX)² + (y-startY)²)
  ├─ if (distance >= DRAG_THRESHOLD_PX && !isDragging):
  │     isDragging = true
  │     ウィンドウ移動開始(IPC経由で main process に通知)
  └─ if (isDragging):
        ウィンドウ位置を更新(IPC)

mouseup 時:
  ├─ if (isDragging):
  │     ウィンドウ位置を最終保存
  │     何もしない(クリック判定にしない)
  ├─ else if (Date.now() - startTime < CLICK_MAX_DURATION_MS):
  │     クリックと判定 → 入力欄を展開
  └─ else:
        長押しと判定 → 何もしない(誤操作回避)
```

#### 定数定義

```typescript
// src/renderer/components/mouse-constants.ts

export const DRAG_THRESHOLD_PX = 5;        // この距離以上でドラッグ判定
export const CLICK_MAX_DURATION_MS = 500;  // この時間未満でクリック判定
```

| 定数 | 値 | 根拠 |
|------|-----|------|
| `DRAG_THRESHOLD_PX` | 5px | Windows標準のドラッグ閾値範囲(4〜10px)。マウスの手ぶれ吸収 |
| `CLICK_MAX_DURATION_MS` | 500ms | 一般的な「短押し」「長押し」の境界値 |

数値は将来的に調整可能とするため、ハードコードではなく定数として一元管理する。

### 8.3 移動操作

- キャラ画像部分の mousedown を起点に、§8.2 の判別ロジックを通る
- ドラッグ確定後は IPC 経由で main process の `moveWindow(x, y)` を呼ぶ
- 移動後の位置を `data/config/window-position.json` に保存

### 8.4 入力欄の表示

- デフォルト:キャラのみ表示
- §8.2 で「クリック」と判定された時のみ入力欄を展開
- ESCキーで入力欄を閉じる

### 8.5 応答吹き出し(SpeechBubble)

ENE の応答を表示する吹き出しのライフサイクルを明確に定義する。
要件 F-BUBBLE-01〜08 を実装するための具体仕様。

#### 表示・消滅条件

| イベント | 動作 |
|---------|------|
| ENE が応答した時 | 吹き出しを表示開始 |
| 表示から 30 秒経過 | 自動消滅 |
| ユーザーが新しい入力を送信 | 古い吹き出しを即座に消去(新応答が次に表示される) |
| 吹き出し本体をクリック | 即座に閉じる |
| ESC キー押下 | 即座に閉じる |

#### レイアウト仕様

| 項目 | 値 |
|------|-----|
| 横幅 | キャラ幅相当(約 240px・固定) |
| 高さ | 内容に応じて縦方向に自動拡張 |
| 最大高さ | 400px(超過時は内部スクロール) |
| 表示位置 | キャラの上部(画面端で見切れる場合は下部に反転) |
| フォントサイズ | 13〜14px |
| 文字色・背景 | 透過ウィンドウに馴染む半透明背景 + 黒文字 |

#### 定数定義

```typescript
// src/renderer/components/bubble-constants.ts

export const BUBBLE_AUTO_DISMISS_MS = 30_000;   // 30秒で自動消滅
export const BUBBLE_MAX_WIDTH_PX = 240;
export const BUBBLE_MAX_HEIGHT_PX = 400;
```

数値は将来的に調整可能とするため、ハードコードではなく定数として一元管理する。

#### React 実装方針

```typescript
// src/renderer/components/SpeechBubble.tsx(疑似コード)

function SpeechBubble({ message, onClose }) {
  // 自動消滅タイマー
  useEffect(() => {
    const timer = setTimeout(onClose, BUBBLE_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  // ESC キーで閉じる
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="bubble" onClick={onClose}
         style={{ maxWidth: BUBBLE_MAX_WIDTH_PX, maxHeight: BUBBLE_MAX_HEIGHT_PX, overflowY: "auto" }}>
      {message}
    </div>
  );
}
```

新しい応答が来たら、親コンポーネントが `message` を切り替えることで
古い吹き出しが自然に置き換わる。

### 8.6 透明領域のクリックスルー

透過ウィンドウは「キャラPNGの周りに透明な領域」がある。この透明領域で
ユーザーがクリックすると、デフォルトでは ENE のウィンドウがイベントを
受け取り、**裏のデスクトップ操作が遮られる**。

これを防ぐため、**ピクセル単位でクリックスルー**を実装する。

#### 動作原理

Electron の `BrowserWindow.setIgnoreMouseEvents(true, { forward: true })` を使用。
これによりウィンドウ全体がマウスイベントを下に通すが、`forward: true` により
**マウス移動イベントだけは Renderer に送られ続ける**ため、現在のカーソル位置の
透明度を判定できる。

#### 実装方針

```typescript
// src/renderer/components/CharacterDisplay.tsx(疑似コード)

function CharacterDisplay() {
  const imgRef = useRef<HTMLImageElement>(null);

  // マウスがキャラ画像の上にあるかを判定
  // (キャンバスにキャラ画像を描画し、現在位置の alpha 値を読む)
  function onMouseMove(e: React.MouseEvent) {
    const isOnOpaque = checkOpaquePixel(imgRef.current, e.clientX, e.clientY);

    if (isOnOpaque) {
      // 不透明な部分:イベントを受け取る
      window.ene.setIgnoreMouseEvents(false);
    } else {
      // 透明な部分:イベントをデスクトップに通す
      window.ene.setIgnoreMouseEvents(true);
    }
  }

  return <img ref={imgRef} src="portrait.png" onMouseMove={onMouseMove} />;
}
```

#### IPC チャンネル追加(EneAPI への追加分)

setIgnoreMouseEvents は §4.2 の EneAPI 定義に既に追加済み。
ここでは Main process 側のハンドラ実装方針のみ示す。

```typescript
// src/main/ipc.ts
ipcMain.handle("ene:set-ignore-mouse-events", (event, ignore: boolean) => {
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});
```

#### 例外:吹き出しと入力欄

吹き出し・入力欄が表示されている時は、それらの上ではマウスイベントを
受け取る必要がある。Renderer側で「キャラ不透明 OR 吹き出し OR 入力欄」の
いずれかの上にカーソルがあれば不透過と判定する。

### 8.7 初回起動時のユーザーガイド

初見ユーザーが「どうやって話しかけるの?」で詰まらないよう、ENE 自身が
キャラ口調で操作方法を教える。**チュートリアルダイアログのような
「アプリ的UI」は出さない**(キャラの世界観を保つため)。

#### 判定ロジック

`active-character.json`(スキーマは §5.4 を参照)の `firstLaunchCompleted: boolean`
フィールドを使って、初回起動を判定する。

```typescript
// src/shared/types/character.ts のスキーマ定義は §5.4 を真実の源とする
// ここでは判定の使い方のみ示す
```

#### 起動時の挨拶ロジック(§7.1 のステップ11 を詳細化)

```typescript
// 起動完了時のキャラ挨拶生成(疑似コード)

function generateGreeting(active: ActiveCharacter, charContext: CharacterContext): string {
  if (!active.firstLaunchCompleted) {
    // 初回起動:ENE が自己紹介 + 操作説明
    // few-shot の firstLaunchGreeting カテゴリから選択
    return charContext.firstLaunchMessage;
    // 例:「あー…なんか久しぶりにこっち来た感じ。
    //      …べ、別に話したいわけじゃないけど、
    //      私のことクリックしてくれたら話せるから。よろしくね。」
  } else {
    // 2回目以降:通常の挨拶
    return charContext.normalGreeting;
    // 例:「おかえり」「久しぶりじゃない」
  }
}

// 挨拶表示後、初回フラグを true に更新
if (!active.firstLaunchCompleted) {
  active.firstLaunchCompleted = true;
  await saveActiveCharacter(active);
}
```

#### Few-shot への影響(別添A)

`fewshot.json` に新たに `firstLaunchGreeting` キーを追加し、
キャラごとの初回挨拶文を定義する(別添A §A.4 で詳細サンプル提供)。

### 8.8 アプリ終了手段とタスクトレイ

フレームレス設計(`frame: false`)のため、ウィンドウに「×」ボタンが存在しない。
ユーザーがアプリを終了する手段として、**タスクトレイメニューと
キャラクター右クリックメニューの2系統**を提供する。

#### タスクトレイアイコン

```typescript
// src/main/tray.ts(実装方針)

import { Tray, Menu, app, nativeImage } from "electron";

let tray: Tray | null = null;

function createTray(mainWindow: BrowserWindow) {
  const icon = nativeImage.createFromPath(/* キャラ顔アイコン */);
  tray = new Tray(icon);

  const menu = Menu.buildFromTemplate([
    {
      label: "ENE を表示 / 隠す",
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
        }
      },
    },
    {
      label: "ENE と話す",
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send("ene:open-input-area");
      },
    },
    { type: "separator" },
    {
      label: "ENE について",
      click: () => { /* バージョン情報ダイアログ */ },
    },
    {
      label: "ENE を終了",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip("ENE - Desktop Character Agent");

  // シングルクリックでウィンドウ表示/非表示
  tray.on("click", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
}
```

#### キャラクター右クリックメニュー

```typescript
// src/renderer/components/CharacterDisplay.tsx(実装方針)

function onContextMenu(e: React.MouseEvent) {
  e.preventDefault();
  window.ene.showCharacterContextMenu();  // IPC で main process に依頼
}

// src/main/ipc.ts(実装方針)

ipcMain.handle("ene:show-character-context-menu", (event) => {
  const menu = Menu.buildFromTemplate([
    {
      label: "話す",
      click: () => mainWindow.webContents.send("ene:open-input-area"),
    },
    { type: "separator" },
    {
      label: "位置をリセット",
      click: () => mainWindow.webContents.send("ene:reset-position"),
    },
    {
      label: "APIキーを設定...",     // §3.7 のダイアログを再表示
      click: () => openApiKeyDialog(),
    },
    { type: "separator" },
    {
      label: "じゃあね...",  // キャラ口調の終了文言
      click: () => app.quit(),
    },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
});
```

#### 設計判断

| 項目 | 採用 | 理由 |
|------|------|------|
| タスクトレイ | ✅ | Windowsユーザーが常駐アプリの終了を探す第一候補 |
| キャラ右クリック | ✅ | 直感的・ENEの世界観に馴染む |
| ウィンドウ「×」 | ✕ | フレームレス設計のため不可。代替手段が上記2系統 |
| ショートカット | ✕(MVP) | 将来検討。MVPでは複雑度を増やさない |

#### 終了文言のキャラ依存性

「ENEを終了」「じゃあね...」のような文言はキャラに依存する。
MVPではコード内に直接記述するが、**将来的に `identity.json` に
`exitLabel: string` 等のフィールドを追加して移行可能な構造**としておく
(キャラ入れ替え時の世界観維持のため)。

---

## 9. ビルドと配布

### 9.1 開発時

```bash
npm run dev        # electron-vite dev起動(HMR対応)
npm run test       # Vitestで単体テスト
npm run lint       # ESLint実行
npm run typecheck  # tscで型チェックのみ
```

### 9.2 ビルド

```bash
npm run build      # TypeScript→JS、最適化
npm run package    # electron-builderでexe生成
```

### 9.3 electron-builder設定方針

```yaml
# electron-builder.yml
appId: com.example.ene-desktop
productName: ENE Desktop
directories:
  output: dist
files:
  - "out/**/*"
  - "characters/**/*"     # 初期キャラを同梱
win:
  target: portable        # インストール不要のexe
  icon: resources/icon.ico
```

### 9.4 配布サイズの目標

- **目標**:100MB以下
- Electronランタイム:約60MB(最小化困難)
- アプリコード + React + Vite:約5MB
- キャラリソース:約1MB
- 余裕度:約30MB(将来の拡張用)

---

## 10. テスト戦略

### 10.1 テストレベル

| レベル | 対象 | ツール |
|--------|------|--------|
| 単体テスト | 純粋関数(loader, parser, search等) | Vitest |
| 統合テスト | Layer間連携(Router→Character→Conv) | Vitest |
| 受入テスト | タスクごとのチェックリスト | 手動 + 一部自動 |

### 10.2 テスト不要・困難な領域

- Electronのウィンドウ表示動作 → 手動確認
- 透過表示 → 手動確認
- Claude API呼出 → モックで代替

### 10.3 テストファースト推奨領域

- Knowledge Router(複雑な分岐ロジック)
- Memory Layer の検索(エッジケース多い)
- 応答JSONパース(不正入力対応)

---

## 11. 拡張ポイント(MVP後を見据えた設計)

以下の機能を将来追加する想定で、現在の設計を組む。

### 11.1 音声入力・音声合成

- UI側に音声入力ボタンを追加する余地を確保
- Conversation Layer は文字列受取なので、音声→テキスト変換を別レイヤーで挟むだけで済む

### 11.2 Live2D対応

- `CharacterDisplay.tsx` を Live2D版に差し替えるだけで対応可能な構造
- IPCの `getCharacterInfo` に Live2D設定ファイルパスを追加可能

### 11.3 複数キャラクター切替

- `characters/` ディレクトリにキャラを追加するだけで対応
- 将来的に `getCharacterList()` などのIPCを追加

### 11.4 高度な記憶検索

- Memory Layerの `searchEpisodic` のシグネチャを保ったまま、
  内部実装をベクトル検索に差し替え可能
- SQLite + sqlite-vss などへの移行を想定

### 11.5 感情モデル

- ConversationResponseに `emotion?: string` を追加するだけで拡張可能
- CharacterDisplayが表情差分を切り替える

### 11.6 忘却機構(ビジョン§3 柱1由来・最重要拡張)

ビジョン§3 柱1「人間らしい忘却」を実現するための機構。
MVPでは実装しないが、**スケール想定の表(§3.3)で示した通り、
中期記憶が増えるにつれ必須となる将来拡張**である。

**実装する処理**:

| 処理 | タイミング | 動作 |
|------|----------|------|
| 月次サマリ | 月初(または起動時に判定) | 先月のEpisodic Memoryを要約し、重要度2以下の元データを削除 |
| 年次サマリ | 年初(または起動時に判定) | 過去1年の月次サマリを再要約し、月次データを削除 |
| 5年サマリ | 5年経過時 | 過去5年の年次サマリを再要約 |
| ユーザー指示削除 | 随時 | 「この記憶を忘れて」で指定記憶を削除 |

**設計の前提**:

- Episodic Memoryに `importance: 1〜5` が必須(F-MEM-E-06)
- 重要度の低い記憶(1〜2)から優先的に削除される
- 重要度4〜5の記憶は再要約されても残り続ける可能性が高い
- Semantic Memory に統合された価値観・性格は別途保持される

**段階的な記憶の縮退**:

```
直近1ヶ月:全Episodic Memory(詳細)
   ↓ 月次サマリ
1ヶ月〜1年:重要度3以上の詳細 + 月次サマリ
   ↓ 年次サマリ
1〜5年:重要度4以上の詳細 + 年次サマリ
   ↓ 5年サマリ
5年以上:5年サマリ + 重要度5の特別な記憶のみ
```

これにより、10年経ってもEpisodic Memoryは1,000件以下に収まり、
全ファイル走査でも実用速度を維持できる。

> 📌 **この拡張は「データ量を抑えるための高速化」ではなく、
> 「人間らしい忘却を再現するビジョン由来の本質的機能」である。**
> 検索インデックス方式やベクトル検索よりも先に、本機構を実装すること。

### 11.7 マルチプロバイダ対応(LLM抽象化)

MVPでは Anthropic API のみを前提とするが、将来的に他のLLMプロバイダ
(OpenAI、Google Gemini、ローカルLLM 等)への対応を視野に入れる可能性がある。

**MVP時点では実装しない**(複雑度を避けるため)が、将来の拡張時は以下の方針を採る:

- `LLMProvider` インターフェースを `src/llm/types.ts` に定義
- `AnthropicProvider` 実装に切り出し(現状の Conversation Layer 内ロジックを移動)
- `OpenAIProvider` 等を追加実装することで切替可能とする
- Prefill のような Anthropic 固有の最適化は `LLMRequest.prefillAssistant?` のような
  オプション項目とし、対応プロバイダのみが解釈する設計とする
- ユーザーがプロバイダを選択する UI は、設定画面拡張(将来)と併せて実装

この拡張時、Conversation Layer のロジック自体は変わらず、
**LLM呼び出し部分のみが差し替え可能**な構造になる。

### 11.8 プロダクトの更新運用

#### MVPの更新方式:手動 exe 差し替え

MVPでは**自動更新機構を実装しない**。新バージョン配布時は、ユーザーが
新しい exe を手動でダウンロードし、既存の exe を上書きする運用とする。

##### 更新の手順(ユーザー目線)

```
1. 開発者が新バージョンの ene-desktop.exe を公開
2. ユーザーが新 exe をダウンロード
3. 既存の ene-desktop.exe を新しいものに置き換え
4. data/ ディレクトリはそのまま(記憶・設定が引き継がれる)
5. %APPDATA%/ene-desktop/api-key.enc もそのまま(APIキー再入力不要)
6. アプリ再起動
```

##### この設計が成立する根拠

- **コードとデータの分離**(設計書 §2):exe を上書きしても `data/` は無影響
- **APIキーの分離**(設計書 §3.6 部分暗号化):`%APPDATA%` 配下のキーも残る
- **設定ファイル**(`active-character.json`、`window-position.json`):`data/config/` で保持
- 結果として、**ユーザーは exe を差し替えるだけで、何も失わず最新版に移行できる**

#### 更新が必要になるシナリオ

| シナリオ | 影響 | 頻度 |
|---------|------|------|
| Electron のセキュリティ脆弱性 | 必須(同梱ライブラリの更新) | 年2〜4回 |
| @anthropic-ai/sdk の API追従 | 必要(API仕様変更時) | 数ヶ月〜年単位 |
| バグ修正・新機能 | 任意 | 開発者判断 |
| OS のメジャー更新 | 必要に応じて(Electron が対応すれば自動追従) | 数年単位 |

#### 後方互換性の維持義務

新バージョンは、**既存ユーザーの `data/` を読み込めること**を必須要件とする。

- 記憶ファイルのスキーマ変更は破壊的変更であり、原則禁止
- やむを得ず変更する場合は、起動時にマイグレーション処理を実装すること
  - 例:`semantic.json` の `version: 1` を読んで `version: 2` に変換する
- スキーマバージョンフィールドを尊重する(`SemanticMemory.version` 等)

#### 将来の自動更新(MVP対象外)

将来的にユーザー数が増えた場合、`electron-updater` ライブラリ等で
自動更新機構を導入する選択肢がある。実装する場合は以下を考慮:

- 配布サーバ(GitHub Releases 等)の準備
- コード署名証明書の取得(Windows のセキュリティ警告回避)
- バックグラウンドダウンロード・適用フロー
- ユーザーへの更新通知UI

MVPではこれらすべてを見送り、シンプルな手動配布から始める。

---

## 12. 設計上の注意事項(Claude Code向け)

### 12.1 実装時に避けること

- ❌ Renderer Process でファイルシステムに直接アクセスする(IPC経由必須)
- ❌ レイヤーをまたいで型を再定義する(`shared/types/` から import)
- ❌ Promise の `.then` チェーン(`async/await` を使う)
- ❌ ハードコードされた文字列メッセージ(キャラ依存値は JSON へ)
- ❌ 同期I/O(`fs.readFileSync` 等。`fs.promises` を使う)

### 12.2 推奨パターン

- ✅ 各レイヤーのファイルは300行以内に収める
- ✅ 純粋関数を優先する(副作用は最小化)
- ✅ ロガーは必ず `src/shared/logger.ts` 経由
- ✅ パス操作は必ず `src/storage/paths.ts` 経由
- ✅ エラーメッセージは日本語で書く

### 12.3 不明点の解決手順

1. このドキュメント(03_design.md)を確認
2. 要件定義書(02_requirements.md)を確認
3. ビジョン(01_vision.md)で本質を確認
4. それでも不明ならユーザーに質問

---

*本設計書は実装の指針である。実装中に「より良い方法」が見つかった場合は、*
*ユーザーに提案・承認を得た上で本設計書を更新すること。*

# 設計書改訂：記憶データモデル v2（MVP 0.3）

> **この文書の位置づけ**
> `docs/03_design.md` の **§3.3 Memory Layer** と **§5.2 Episodic Memory ファイル例**
> に対する、MVP 0.3「記憶の会話活用強化」向けの**データモデル改訂案**。
> 本文書は 0.3 実装着手時に `03_design.md` 本体へマージする（task_13 の前例に倣い、
> 実装時に反映する）。**ここに書かれた追加フィールドはすべて optional で後方互換**。
>
> - 想起・更新の**処理（振る舞い）**は本文書ではなく `tasks/task_15_*.md` と
>   §11.4（ベクトル検索）・§11.6（忘却）に属する。本文書は**データの持ち方のみ**。
> - 真実の源（SSOT）は最終的に `03_design.md`。本文書はマージ前のたたき台。

---

## 0. 改訂の原則（なぜこの形か）

| 原則 | 内容 | 根拠 |
|------|------|------|
| 追加は全て optional | 旧記録に無くても有効＝マイグレーション不要 | §11.8 後方互換 |
| 拡張領域 `extra` を持つ | 型定義を変えず新データを溜め、後で正式フィールドへ昇格 | CLAUDE §4.5 / ユーザー拡張性要件 |
| フィールド最小主義 | 「完全一致／絞り込み／状態フラグ」が要る情報だけフィールド化。あとは `summary` か `extra` へ | 想起の主役は summary のベクトル＋entities |
| データは中立 | 抽出は中立観察者。キャラ口調を混ぜない（ツンデレは想起の**表現時**に人格層で付く） | §3.3 / CLAUDE §5.1（キャラ差し替え可能） |
| 分類は検索の足かせにしない | `category` は表示・年次忘却用。想起は全件横断（ベクトル＋entity＋語彙） | 横断想起（人物・意味）が関係の核 |

---

## 1. §3.3 改訂：型定義

### 1.1 EpisodicMemory（v2・実質 +3フィールド）

```typescript
// src/shared/types/memory.ts

export interface EpisodicMemory {
  schemaVersion: number;        // ★新 2(欠落時は1扱い・マイグレーション用)
  date: string;                 // 既存 ISO8601(ローカルTZ込み)
  topic: string;                // 既存
  summary: string;              // 既存。ENEの立場(eneStance)・出所(provenance)も
                                //   ここに文章で含める（中立記述・ベクトル化対象）
  tags?: string[];              // 既存→任意化。軽い語彙アンカー(主役はsummary+entities)
  entities?: string[];          // ★新 正規名の配列(人物優先)。語彙/逆引き索引の素
  importance: number;           // 既存 1-5(忘却の重み・感情ではない)
  category: string;             // 既存 health/work/…(表示・年次忘却用)
  supersededBy?: string;        // ★新 置換した新記録のファイル名。存在=この記録は古い
  extra?: Record<string, ExtraValue>;  // ★新 拡張領域
                                //   (emotion/isFirst/provenance等は当面ここに溜める)
}

export type ExtraValue = string | string[] | number | boolean;  // 既存
```

**補足**
- **`id` は持たない**＝ファイルパス（`{date}.json`）が一意IDを兼ねる。`supersededBy` はファイル名で参照。
- **記憶の更新（supersede）**＝旧記録に `supersededBy` を付与するだけ（非破壊）。想起時に「`supersededBy` を持つ記録」を除外して current ビューを得る。`status`/`supersedes`/`revisedAt` は持たない（presence で自明・派生で足りる）。
- **eneStance / provenance** は専用フィールドにせず summary に溶かす（例：「ユーザーは…と言った。**ENEは反対した**。」「**田中さんから聞いた話では**…」）。文章に入れれば自動でベクトル検索対象になる。

### 1.2 RelationshipMemory（人物gist層・**器のみ予約**）

> 中身は将来の Reflection/統合処理（§11.6 / task_15 以降）が埋める。0.3 初期は空でよい。

```typescript
// data/memory/{characterId}/relationships/{canonical}.json
export interface RelationshipMemory {
  schemaVersion: number;
  canonical: string;            // 正規名「田中一郎」(エンティティ正規レジストリ兼用)
  aliases?: string[];           // 表記ゆれ・人物分裂/統合の管理
  gist: string;                 // 「親友。一度喧嘩したが大事に思っている」(質的・数値なし)
  importance: number;           // 関係の重み(忘却優先度)
  updatedAt: string;            // ISO8601
}
```

### 1.3 派生キャッシュ（真実の源ではない・再生成可）

```
data/memory/{characterId}/index/
  ├── vectors        // episodic の summary → 埋め込みベクトル(意味検索)
  └── inverted       // entity / keyword → ファイル名[](語彙・人物逆引き)
```

- **JSON 本体から再生成可能**＝別PCに JSON を持ち運べば作り直せる（§6.1 可搬性を維持）。
- バックアップ対象外でよい。`summary` が変わった記録だけ再ベクトル化（増分）。
- 埋め込みモデル本体は**別ダウンロード**（コア100MBを汚さない）＝ task_15 で承認。

### 1.4 ExtractionResult（抽出器の出力契約・拡張）

```typescript
// src/memory/extractor.ts
export interface ExtractionResult {
  episodic?: EpisodicMemory;            // entities を含む。eneStance/provenance は summary へ
  semanticPatch?: Partial<SemanticMemory>;
  corrections?: Correction[];           // ★新 記憶更新の指示（決定E）
}

export interface Correction {
  targetFile: string;                   // 対象の旧記録（ファイル名=ID）
  kind: 'supersede' | 'refine' | 'reattribute';
  newSummary?: string;
  newEntities?: string[];
  reason?: string;
}
```

### 1.5 MemoryRetriever（想起の抽象・§4.4 疎結合）

> 会話時の想起を Router から分離し、**ユーザー発言を引き金**に全件横断で引く。
> 内部実装（語彙→ハイブリッド→ベクトル）を差し替えても Conversation Layer は無改修。

```typescript
// src/memory/retriever.ts（新規）
export interface RetrievalQuery {
  text: string;                 // ユーザー発言（想起の引き金・Router非依存）
  entities?: string[];          // 抽出済み人物等（任意）
  limit?: number;               // 既定 5
  category?: string;            // 任意の補助フィルタ（通常未指定＝全件横断）
}

export interface MemoryRetriever {
  retrieve(query: RetrievalQuery): Promise<EpisodicMemory[]>;
}
```

- 既存 `searchEpisodic(MemorySearchQuery)` は**明示フィルタ検索用に存続**（§11.4 のシグネチャ保持方針と整合）。会話時の既定想起は `MemoryRetriever` に移す。

---

## 2. §5.2 / §5.5 改訂：ファイル例とディレクトリ

### 2.1 Episodic Memory ファイル例（v2）

```
data/memory/{characterId}/episodic/2026/study/2026-05-10T17-30-00.json
```
```json
{
  "schemaVersion": 2,
  "date": "2026-05-10T17:30:00+09:00",
  "topic": "実力テスト前の過ごし方",
  "summary": "ユーザーは実力テスト前なのに友達と遊びに行くと言った。ENEは勉強すべきだと反対し心配した。",
  "tags": ["実力テスト", "勉強", "遊び"],
  "entities": [],
  "importance": 3,
  "category": "study"
}
```

### 2.2 記憶ディレクトリ構造（§5.5 への追加）

```
data/memory/
└── ene/
    ├── short-term.json
    ├── semantic.json
    ├── episodic/{year}/{category}/{date}.json
    ├── relationships/{canonical}.json   ← ★新 人物gist(予約・派生)
    └── index/                           ← ★新 派生キャッシュ(再生成可)
        ├── vectors
        └── inverted
```

- `relationships/` と `index/` は**非破壊的追加**（既存構造を壊さない）。§5.5 の設計判断「最初から拡張可能な構造／非破壊的拡張」に沿う。

---

## 3. マイグレーション（§11.8 整合）

- 既存 episodic：`schemaVersion` 欠落→1、`entities`/`supersededBy`/`extra` 欠落→なし扱い。
  **書き換え不要**で新コードが読める。
- 新フィールドは**今日から収集開始**、過去分は空のまま（拡張性要件）。
- `index/` が無ければ初回に JSON から再生成。

---

## 4. データモデルと処理の分離（スコープ境界）

| 区分 | 所在 |
|------|------|
| データの持ち方（本文書） | §3.3 / §5.2 改訂 |
| 想起エンジン（ベクトル＋語彙＋entity・RRF合流） | task_15 ＋ §11.4 |
| 記憶更新（supersede 検知・適用） | task_15 |
| 人物gist／関係ナラティブの生成 | 将来（Reflection）＋ §11.6 |
| 忘却・統合 | §11.6 |
| meta記憶（自信度） | 保存しない＝想起時に算出 |
| コスト最適化（Tier/キャッシュ） | task_14（本件と独立） |

---

## 5. 設計判断の記録（実装時に implementation-notes へ N-15-x として転記）

- N: EpisodicMemory を v2 化（+entities/+supersededBy/+extra）。全 optional・後方互換。
- N: `id` はファイルパスで代替（フィールドを持たない）。
- N: eneStance/provenance は summary に文章で吸収（フィールド化しない）。
- N: 想起を Router から分離し `MemoryRetriever` 抽象を新設（§4.4）。
- N: `category` は検索の主キーから降格（横断想起のため）。表示・年次忘却用に存続。
- N: 埋め込みモデル・ベクトル索引は別DL・派生キャッシュ（§6.1 可搬性維持・要承認）。

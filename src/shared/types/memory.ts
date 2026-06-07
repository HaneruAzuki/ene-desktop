// Memory Layer の型定義(設計書 §3.3 / §5.2 / design-revision-memory-v2.md)。

/** 短期記憶エントリ(セッション内の直近会話)。 */
export interface ShortTermEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string; // ローカルTZ込み ISO 8601
  extracted: boolean; // 中期記憶への抽出済みフラグ(重複抽出防止)
}

/**
 * 中期記憶(Episodic): 会話から抽出された出来事・事実の要約。
 *
 * v2(MVP 0.3)で +entities/+supersededBy/+extra/+schemaVersion を追加。
 * すべて optional ＝ 旧記録(v1)を書き換えずに読める後方互換(design-revision-memory-v2 §0)。
 * eneStance(ENEの立場)・provenance(出所)は専用フィールドを設けず summary に文章で織り込む
 * (中立記述・ベクトル検索の対象になる)。
 */
export interface EpisodicMemory {
  schemaVersion?: number; // 欠落時は 1 扱い(migrateEpisodic で補完)。新規保存は 2。
  date: string; // ローカルTZ込み ISO 8601
  topic: string;
  summary: string; // 200文字以内を目安。eneStance/provenance もここに文章で含める。
  tags?: string[]; // 軽い語彙アンカー(主役は summary + entities)
  entities?: string[]; // 正規名(canonical)の配列。人物優先。逆引き索引の素。
  importance: number; // 1-5(忘却の重み・感情ではない)
  category: string; // health, work, hobby など(表示・年次忘却用)
  supersededBy?: string; // 置換した新記録の ID(相対パス)。存在＝この記録は古い(非破壊更新)。
  extra?: Record<string, ExtraValue>; // 拡張領域(emotion/isFirst 等は当面ここに溜める)
  // --- 心(task_16・全 optional・後方互換・design-revision-character-heart §6) ---
  provenance?: 'user' | 'self'; // 欠落=user。self=キャラ自身の人生記憶(canon・読取専用・忘却外)
  valence?: number; // -2..+2。欠落=0(中立)。出来事の感情的トーン(想起バイアス用・感情管理ではない)
  disclosureLevel?: number; // 1..5。欠落=1(初対面から)。親しさ段階で開示制御(開示ゲーティング)
}

/** episodic 記録とその ID(= episodic ルートからの相対パス)の対。 */
export interface EpisodicRecord {
  id: string; // 例 "2026/study/2026-05-10T17-30-00.json"
  memory: EpisodicMemory;
}

/** 記憶更新(supersede)の指示(抽出器が出力し、update.ts が非破壊適用する)。 */
export interface Correction {
  targetFile: string; // 対象の旧記録 ID(= 相対パス)
  kind: 'supersede' | 'refine' | 'reattribute';
  newSummary?: string;
  newEntities?: string[];
  reason?: string;
}

/** extra 領域に許容する値の型(過度な複雑さを避ける)。 */
export type ExtraValue = string | string[] | number | boolean;

/** 長期記憶(Semantic): 性格・好み・価値観。コア + 拡張(extra)の2層。 */
export interface SemanticMemory {
  // コアフィールド(スキーマ検証対象)
  version: number; // スキーマバージョン(MVPは 1)
  userName?: string;
  preferences?: Record<string, string>;
  longTermGoals?: string[];
  personality?: string[];
  // 拡張領域(LLM が自由に追記・構造のみ検証)
  extra?: Record<string, ExtraValue>;
}

/**
 * 人物 gist 層(器のみ予約・design-revision-memory-v2 §1.2)。
 * 中身は将来の Reflection/統合処理が埋める。0.3 初期は未使用。
 */
export interface RelationshipMemory {
  schemaVersion: number;
  canonical: string; // 正規名(エンティティ正規レジストリ兼用)
  aliases?: string[]; // 表記ゆれ・人物分裂/統合の管理
  gist: string; // 質的記述(数値なし)
  importance: number; // 関係の重み(忘却優先度)
  updatedAt: string; // ISO8601
}

/** Episodic 検索クエリ(明示フィルタ用・MVP: タグ/カテゴリ/重要度/年範囲)。 */
export interface MemorySearchQuery {
  tags?: string[];
  category?: string;
  minImportance?: number;
  yearFrom?: number;
  yearTo?: number;
  limit?: number; // デフォルト 5
}

/**
 * 想起クエリ(会話時の既定想起・Router 非依存・design-revision-memory-v2 §1.5)。
 * ユーザー発言(text)を引き金に全件横断で引く。
 */
export interface RetrievalQuery {
  text: string; // ユーザー発言(想起の引き金)
  entities?: string[]; // 抽出済み人物等(任意)
  limit?: number; // 既定 5
  category?: string; // 任意の補助フィルタ(通常未指定＝全件横断)
}

/**
 * 想起の抽象(§4.4 疎結合)。内部実装(語彙→ハイブリッド→ベクトル)を差し替えても
 * Conversation Layer は無改修。
 */
export interface MemoryRetriever {
  retrieve(query: RetrievalQuery): Promise<EpisodicMemory[]>;
}

/** レイヤー間で受け渡す記憶コンテキスト。 */
export interface MemoryContext {
  semantic: SemanticMemory;
  shortTerm: ShortTermEntry[];
  relevantEpisodic: EpisodicMemory[];
}

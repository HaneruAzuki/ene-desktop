// Memory Layer の型定義(設計書 §3.3 / §5.2)。

/** 短期記憶エントリ(セッション内の直近会話)。 */
export interface ShortTermEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string; // ローカルTZ込み ISO 8601
  extracted: boolean; // 中期記憶への抽出済みフラグ(重複抽出防止)
}

/** 中期記憶(Episodic): 会話から抽出された出来事・事実の要約。 */
export interface EpisodicMemory {
  date: string; // ローカルTZ込み ISO 8601
  topic: string;
  summary: string; // 200文字以内を目安
  tags: string[];
  importance: number; // 1-5(必須・将来の忘却機構で参照)
  category: string; // health, work, hobby など
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

/** Episodic 検索クエリ(MVP: タグ/カテゴリ/重要度/年範囲)。 */
export interface MemorySearchQuery {
  tags?: string[];
  category?: string;
  minImportance?: number;
  yearFrom?: number;
  yearTo?: number;
  limit?: number; // デフォルト 5
}

/** レイヤー間で受け渡す記憶コンテキスト。 */
export interface MemoryContext {
  semantic: SemanticMemory;
  shortTerm: ShortTermEntry[];
  relevantEpisodic: EpisodicMemory[];
}

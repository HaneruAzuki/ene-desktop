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
  // --- 気にかけ(P4・open loops・N-PRES-4・全 optional・後方互換) ---
  // 「まだ結末が出ていない出来事」「キャラ自身がした約束」「聞きそびれ」を未解決マークとして持つ。
  // 想起(話題依存)とは別に、話の切れ目で「そういえばあの件どうなった?」と自発的に触れるための材料。
  openLoop?: OpenLoop;
}

/**
 * 気にかけ(open loop)。結末が出ていない事柄の最小記録(P4・N-PRES-4)。
 * 感情スカラーではなく事実(§5.3)。resolvedAt が立つと「閉じた=もう気にかけない」。
 */
export interface OpenLoop {
  kind: 'user-event' | 'promise-by-me' | 'question'; // 相手の進行中の出来事 / キャラの約束 / 聞きそびれ
  note: string; // 一文の覚書(例「相手は6/14に面接を受ける。結果を聞いていない」)。そのまま注入できる体裁。
  resolvedAt?: string; // 結末が判明した日時(ローカルTZ込み ISO 8601)。立つと未解決の探索から外れる。
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

/** 気にかけ(open loop)の解決指示(抽出器が出力し、結末の出た loop に resolvedAt を立てる・P4)。 */
export interface LoopClosure {
  targetFile: string; // 閉じる対象の open loop を持つ episodic の id(= 相対パス)
  resolution?: string; // 結末の覚書(任意・ログ/将来用)
}

/** extra 領域に許容する値の型(過度な複雑さを避ける)。 */
export type ExtraValue = string | string[] | number | boolean;

/** 長期記憶(Semantic): 性格・好み・価値観。コア + 拡張(extra)の2層。 */
export interface SemanticMemory {
  // コアフィールド(スキーマ検証対象)
  version: number; // スキーマバージョン(MVPは 1)
  userName?: string;
  userNameReading?: string; // 名前の読み(かな)。呼びかけTTS用(ルビ機構で発声)・STT誤認の照合用(P5)
  userBirthday?: UserBirthday; // 相手の誕生日(構造化スロット・祝う/矛盾指摘に使う・P5)
  preferences?: Record<string, string>;
  longTermGoals?: string[];
  personality?: string[];
  // 拡張領域(LLM が自由に追記・構造のみ検証)
  extra?: Record<string, ExtraValue>;
}

/** 相手の誕生日(月日は必須・年は任意)。一級フィールドにして「今日が誕生日か」を機械判定可能にする(P5)。 */
export interface UserBirthday {
  month: number; // 1-12
  day: number; // 1-31
  year?: number; // 任意(言わなければ持たない)
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

/** レイヤー間で受け渡す記憶コンテキスト。 */
export interface MemoryContext {
  semantic: SemanticMemory;
  shortTerm: ShortTermEntry[];
  relevantEpisodic: EpisodicMemory[];
  /**
   * 環境・存在文脈(P1/P4/P5/P7・任意・後方互換)。
   * 会話経路(buildConversationMemory)が毎ターン算出し、prompt-builder が揮発コンテキストへ整形する。
   * 揮発=キャッシュ境界より後ろ。ウォーム/テストでは未指定でよい(従来挙動)。
   */
  moment?: ConversationMoment;
}

/**
 * 「いまこの瞬間」の存在文脈(P1/P4/P5/P7・N-PRES-*)。すべて毎ターン変化する揮発情報。
 * キャラの応答に「時間の中で生きている/相手を気にかけている/有限である」感を与える材料。
 */
export interface ConversationMoment {
  nowIso: string; // 現在のローカルTZ込み ISO 8601(P1)
  timeOfDay: string; // 朝/昼/夕方/夜/深夜(P1)
  elapsedLabel?: string; // 前回会話からの経過の言葉(例「3日ぶり」)。同日・初回は undefined(P1)
  openLoops?: string[]; // 気にかけている事柄の覚書(最大 OPEN_LOOP_SURFACE_MAX 件・P4)
  knowledgeGaps?: string[]; // まだ知らない相手の属性ラベル(最大 KNOWLEDGE_GAP_SURFACE_MAX 件・親密度ゲート済・P5)
  userBirthdayToday?: boolean; // 今日が相手の誕生日か(P5)
  finitenessHint?: string; // 有限性のトーン指示(発言内容のみ・例「(いまは深夜。眠そうにしてよい)」・P7)
}

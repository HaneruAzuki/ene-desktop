// Character Layer の型定義(設計書 §3.1 / §5.4)。
// レイヤー間で共有するため src/shared/types/ に集約する(設計書 §12.1)。

/** identity.json: 人格コア */
export interface CharacterIdentity {
  characterId: string;
  name: string;
  nameReading?: string; // 名前の読み(かな)。固有名詞のTTS/STT・自己紹介の furigana 用(任意・後方互換)
  ageAppearance: string; // "少女" など抽象表現(具体的な年齢数値は持たない・CLAUDE §5.2)
  gender: string;
  birthday?: {
    month: number; // 1-12
    day: number; // 1-31
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

/** background.json: 背景設定 */
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

export type DomainLevel = 'high' | 'medium' | 'low' | 'none' | 'refuse';

export interface KnowledgeDomain {
  topics: string[];
  behavior: string;
  rationale: string;
  fewshotKey: string;
}

/** knowledge_domains.json: 知識ドメイン(5段階) */
export interface CharacterKnowledgeDomains {
  characterId: string;
  domains: Record<DomainLevel, KnowledgeDomain>;
  fallback: DomainLevel;
}

export interface FewshotExample {
  user: string;
  assistant: string;
}

/** fewshot.json: ドメイン別応答例 + 誕生日反応 + 起動挨拶 */
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

// --- active-character.json(設計書 §5.4・最小状態管理) ---

export interface BirthdayHistoryEntry {
  year: number; // 西暦
  celebrated: boolean; // ユーザーが誕生日に触れたか
  celebratedAt?: string; // 触れられた日時(ローカルTZ込み ISO 8601)
}

/**
 * 関係の事実(task_16・開示ゲーティング用)。
 * 接触の“事実”のみ(感情/好感度スカラーではない・§5.3)。familiarityStage はこれから導出する。
 */
export interface RelationshipFacts {
  firstMetAt: string; // 初めて会話した日時(ローカルTZ込み ISO 8601)
  lastConversationDate: string; // 直近に会話した日付(YYYY-MM-DD・実日数カウント用)
  distinctConversationDays: number; // 会話した実日数
  totalTurns: number; // 累計やりとり回数
}

export interface ActiveCharacter {
  version: number; // スキーマバージョン(MVPは 1)
  characterId: string; // 現在使用中のキャラ ID
  selectedAt: string; // 切り替えた日時(ローカルTZ込み ISO 8601)
  birthdayHistory: BirthdayHistoryEntry[];
  firstLaunchCompleted: boolean; // 初回起動の操作案内表示済みフラグ(§8.7)
  relationship?: RelationshipFacts; // ★task_16 開示ゲーティングの素(事実のみ)
}

/**
 * 現在状態レイヤー(task_16・決定5)。更新可能な“今”(事実のみ・感情スカラーなし)。
 * characters/{id}/current-state.json。不在でも background のみで動く(後方互換)。
 */
export interface CurrentState {
  characterId: string;
  asOf: string; // この“今”の基準時刻(ローカルTZ込み ISO 8601)
  currentHobbies?: string[]; // マイブーム・追加趣味
  familySituation?: string; // 最近の家族関係の近況(事実)
  currentStatus?: string; // 現況・近況(事実)
}

/** レイヤー間で受け渡す統合コンテキスト */
export interface CharacterContext {
  identity: CharacterIdentity;
  background: CharacterBackground;
  knowledgeDomains: CharacterKnowledgeDomains;
  fewshot: CharacterFewshot;
  portraitPath: string; // 絶対パス
  systemPrompt: string; // 構築済みのキャラクター人格プロンプト(応答形式は Conversation Layer が付与)
  birthdayHint?: 'today' | 'forgotten' | null;
  currentState?: CurrentState | null; // ★task_16 現在状態(任意・不在可)
}

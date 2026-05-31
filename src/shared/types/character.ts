// Character Layer の型定義(設計書 §3.1 / §5.4)。
// レイヤー間で共有するため src/shared/types/ に集約する(設計書 §12.1)。

/** identity.json: 人格コア */
export interface CharacterIdentity {
  characterId: string;
  name: string;
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

export interface ActiveCharacter {
  version: number; // スキーマバージョン(MVPは 1)
  characterId: string; // 現在使用中のキャラ ID
  selectedAt: string; // 切り替えた日時(ローカルTZ込み ISO 8601)
  birthdayHistory: BirthdayHistoryEntry[];
  firstLaunchCompleted: boolean; // 初回起動の操作案内表示済みフラグ(§8.7)
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
}

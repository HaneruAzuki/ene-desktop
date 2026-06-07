import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/character/system-prompt-builder';
import type {
  CharacterIdentity,
  CharacterBackground,
  CharacterKnowledgeDomains,
  KnowledgeDomain,
} from '../../src/shared/types/character';

const identity: CharacterIdentity = {
  characterId: 'ene',
  name: 'ENE',
  ageAppearance: '少女',
  gender: 'female',
  birthday: { month: 8, day: 15 },
  personality: {
    core: 'ツンデレ、IT好き',
    tone: '強気だが照れ屋',
    firstPerson: '私',
    speechEndings: ['〜なんだから!', '〜よ'],
  },
  selfRecognition: {
    callsSelf: 'ENE',
    neverCallsSelf: ['AI', 'アシスタント', 'モデル', 'プログラム'],
    aiQuestionHandling: 'ツンデレ調ではぐらかす',
  },
};

const background: CharacterBackground = {
  characterId: 'ene',
  birthplace: '都内某所',
  family: { father: 'ITエンジニア' },
  education: '高校生',
  hobbies: ['プログラミング', 'ゲーム'],
  dislikes: ['早起き'],
  lifeExperience: { exposedTo: ['パソコン'], notExposedTo: ['パチンコ'] },
};

function dom(topics: string[], behavior: string, fewshotKey: string): KnowledgeDomain {
  return { topics, behavior, rationale: '', fewshotKey };
}

const knowledgeDomains: CharacterKnowledgeDomains = {
  characterId: 'ene',
  domains: {
    high: dom(['プログラミング'], '詳しく説明する', 'tech_high'),
    medium: dom(['数学'], '一般的に答える', 'general_medium'),
    low: dom(['料理'], '前置きして簡単に', 'general_low'),
    none: dom(['パチンコ'], '素で困惑する', 'unknown_none'),
    refuse: dom(['違法行為'], '明確に断る', 'refuse'),
  },
  fallback: 'medium',
};

describe('system-prompt-builder (設計書 §3.1 / §3.4)', () => {
  it('neverCallsSelf の全語を含む(AI自称防止)', () => {
    const prompt = buildSystemPrompt(identity, background, knowledgeDomains);
    for (const word of identity.selfRecognition.neverCallsSelf) {
      expect(prompt).toContain(word);
    }
  });

  it('名前・一人称・口調を含む', () => {
    const prompt = buildSystemPrompt(identity, background, knowledgeDomains);
    expect(prompt).toContain('ENE');
    expect(prompt).toContain('私');
    expect(prompt).toContain('強気だが照れ屋');
  });

  it('知らない領域(none)の振る舞いと、経験がないものを含む', () => {
    const prompt = buildSystemPrompt(identity, background, knowledgeDomains);
    expect(prompt).toContain('パチンコ');
    expect(prompt).toContain('素で困惑する');
  });

  it('JSON 応答形式の指示は含まない(Conversation Layer が付与・疎結合)', () => {
    const prompt = buildSystemPrompt(identity, background, knowledgeDomains);
    expect(prompt).not.toContain('os_command');
    expect(prompt).not.toContain('"type"');
  });

  it('現在状態(task_16)があれば「今のあなた」節を含む', () => {
    const prompt = buildSystemPrompt(identity, background, knowledgeDomains, {
      characterId: 'ene',
      asOf: '2026-06-07T12:00:00+09:00',
      currentHobbies: ['シュタゲ再履修'],
      currentStatus: '夜型加速中',
    });
    expect(prompt).toContain('今のあなた');
    expect(prompt).toContain('シュタゲ再履修');
    expect(prompt).toContain('夜型加速中');
  });

  it('現在状態が無ければ「今のあなた」節は出ない(Tier0 不変)', () => {
    const prompt = buildSystemPrompt(identity, background, knowledgeDomains, null);
    expect(prompt).not.toContain('今のあなた');
  });
});

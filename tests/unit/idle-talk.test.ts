import { describe, it, expect } from 'vitest';
import {
  shouldSpeakIdle,
  buildIdleTalkPrompt,
  parseIdleTalkResponse,
  type IdleTalkState,
} from '../../src/conversation/idle-talk';
import {
  IDLE_TALK_MIN_SILENCE_MS,
  IDLE_TALK_DAILY_MAX,
  IDLE_TALK_MIN_INTERVAL_MS,
  IDLE_TALK_PRESENCE_MAX_IDLE_SEC,
} from '../../src/shared/constants';

// P7: 自発発話の発火判定(多重ガード)+ プロンプト/パース。

const NOW = Date.parse('2026-06-13T14:00:00+09:00'); // 昼(静音時間外)

/** 発火する基準状態(各テストで1条件だけ崩す)。 */
function okState(): IdleTalkState {
  return {
    enabled: true,
    nowMs: NOW,
    hour: 14,
    lastConversationMs: NOW - IDLE_TALK_MIN_SILENCE_MS - 1000, // 十分に沈黙
    lastIdleTalkMs: null,
    idleTalkCountToday: 0,
    osIdleSec: 5, // 在席(浅いアイドル)
    hasMaterial: true,
  };
}

describe('shouldSpeakIdle (P7)', () => {
  it('基準状態では発火する', () => {
    expect(shouldSpeakIdle(okState())).toBe(true);
  });
  it('設定 off では発火しない', () => {
    expect(shouldSpeakIdle({ ...okState(), enabled: false })).toBe(false);
  });
  it('静音時間帯(深夜)では発火しない', () => {
    expect(shouldSpeakIdle({ ...okState(), hour: 2 })).toBe(false);
  });
  it('一度も会話していない相手には話しかけない', () => {
    expect(shouldSpeakIdle({ ...okState(), lastConversationMs: null })).toBe(false);
  });
  it('直近まで会話していたら発火しない', () => {
    expect(shouldSpeakIdle({ ...okState(), lastConversationMs: NOW - 1000 })).toBe(false);
  });
  it('1日上限に達したら発火しない', () => {
    expect(shouldSpeakIdle({ ...okState(), idleTalkCountToday: IDLE_TALK_DAILY_MAX })).toBe(false);
  });
  it('前回の自発発話から間隔が空いていないと発火しない', () => {
    expect(shouldSpeakIdle({ ...okState(), lastIdleTalkMs: NOW - IDLE_TALK_MIN_INTERVAL_MS + 1000 })).toBe(false);
  });
  it('離席中(OSアイドルが深い)は発火しない', () => {
    expect(shouldSpeakIdle({ ...okState(), osIdleSec: IDLE_TALK_PRESENCE_MAX_IDLE_SEC })).toBe(false);
  });
  it('話す材料がなければ発火しない', () => {
    expect(shouldSpeakIdle({ ...okState(), hasMaterial: false })).toBe(false);
  });
});

describe('idle-talk prompt / parse (P7)', () => {
  it('材料をプロンプトに織り込む', () => {
    const p = buildIdleTalkPrompt({
      systemPrompt: 'あなたはトリミ。',
      timeOfDay: '夜',
      openLoops: ['面接の結果待ち'],
      recentLife: ['今日は一日コードを書いていた'],
    });
    expect(p.user).toContain('夜');
    expect(p.user).toContain('面接の結果待ち');
    expect(p.user).toContain('今日は一日コードを書いていた');
  });
  it('応答 JSON から message/emotion を取り出す', () => {
    const r = parseIdleTalkResponse('{"message":"ねえ、面接どうだった?","emotion":"neutral"}');
    expect(r?.message).toBe('ねえ、面接どうだった?');
    expect(r?.emotion).toBe('neutral');
  });
  it('message が無ければ null', () => {
    expect(parseIdleTalkResponse('{"emotion":"joy"}')).toBeNull();
    expect(parseIdleTalkResponse('こわれた')).toBeNull();
  });
});

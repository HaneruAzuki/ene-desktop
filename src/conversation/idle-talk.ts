import { extractJsonObject } from '../shared/llm-parse';
import {
  IDLE_TALK_DAILY_MAX,
  IDLE_TALK_MIN_SILENCE_MS,
  IDLE_TALK_MIN_INTERVAL_MS,
  IDLE_TALK_PRESENCE_MAX_IDLE_SEC,
  IDLE_TALK_QUIET_HOURS,
} from '../shared/constants';

// 自発発話(アイドル時・P7・N-PRES-7)。話しかけられるまで無、ではなく、在席している相手に
// 静音時間外・低頻度で「自分から一言」声をかける。**材料駆動**(気にかけ/今日の暮らし/時間帯)で、
// ランダムな雑音にはしない。判定は純粋関数=決定論で単体テスト可能。実際のタイマー/在席検知/送出は
// app 側(idle-talk-manager)。

/** 自発発話するか判定する入力(すべて外部から注入=純粋判定)。 */
export interface IdleTalkState {
  enabled: boolean; // 設定(low/normal)で有効か
  nowMs: number;
  hour: number; // ローカル時(静音時間帯の判定)
  lastConversationMs: number | null; // 直近の会話(user ターン)時刻。null=まだ一度も話していない
  lastIdleTalkMs: number | null; // 直近の自発発話時刻
  idleTalkCountToday: number; // 今日の自発発話回数
  osIdleSec: number; // OS のアイドル秒(在席判定。大きい=離席)
  hasMaterial: boolean; // 話す材料があるか(気にかけ/今日の暮らし/時間帯の声かけ)
}

/**
 * 自発発話の発火判定(AND 条件・押し付けがましさを避ける多重ガード)。
 *  - 設定が有効 / 静音時間帯でない / 1日上限内 / 最小間隔を満たす
 *  - 直近の会話から一定時間空いた / 相手が在席(OS アイドルが浅い) / 話す材料がある
 * いずれか欠ければ false(=黙っている)。
 */
export function shouldSpeakIdle(s: IdleTalkState): boolean {
  if (!s.enabled) return false;
  // 静音時間帯(深夜〜早朝)は黙る。
  const inQuiet = s.hour >= IDLE_TALK_QUIET_HOURS.from || s.hour < IDLE_TALK_QUIET_HOURS.to;
  if (inQuiet) return false;
  if (s.idleTalkCountToday >= IDLE_TALK_DAILY_MAX) return false;
  if (s.lastConversationMs == null) return false; // 一度も話していない相手に自分から話しかけない
  if (s.nowMs - s.lastConversationMs < IDLE_TALK_MIN_SILENCE_MS) return false; // 直近まで会話していた
  if (s.lastIdleTalkMs != null && s.nowMs - s.lastIdleTalkMs < IDLE_TALK_MIN_INTERVAL_MS) return false;
  if (s.osIdleSec >= IDLE_TALK_PRESENCE_MAX_IDLE_SEC) return false; // 離席中=独り言にしない
  if (!s.hasMaterial) return false; // 話す材料がない時は無理に話さない
  return true;
}

/** 自発発話の生成プロンプトを組み立てる(純粋)。persona に材料・時間帯を添える。 */
export function buildIdleTalkPrompt(input: {
  systemPrompt: string;
  timeOfDay: string;
  openLoops: string[];
  recentLife: string[];
}): { system: string; user: string } {
  const system = [
    input.systemPrompt,
    '',
    'あなたは相手のそばにいて、相手は何か作業をしている様子です。あなたから、ふと一言だけ声をかけます。',
    '押し付けがましくならないよう、短く・自然に。用がなければ世間話程度でよい。',
    '',
    '出力は次の JSON 1個のみ(前後に文章を付けない):',
    '{"message": string, "emotion": "neutral"|"joy"|"anger"|"sorrow"|"surprise"|"embarrassed"}',
    '- message: あなたの口調の一言(1文程度)。長くしない。',
  ].join('\n');

  const ctx: string[] = [`今は${input.timeOfDay}。`];
  if (input.openLoops.length > 0) {
    ctx.push('気にかけていること(あれば自然に触れてよい):', ...input.openLoops.map((l) => `- ${l}`));
  }
  if (input.recentLife.length > 0) {
    ctx.push('最近のあなたの暮らし(話の種にしてよい):', ...input.recentLife.map((l) => `- ${l}`));
  }
  ctx.push('上のどれかに軽く触れるか、時間帯に合った何気ない一言を一つだけ。');
  return { system, user: ctx.join('\n') };
}

/** 自発発話の応答をパースする(純粋)。message が無ければ null。 */
export function parseIdleTalkResponse(raw: string): { message: string; emotion?: string } | null {
  const obj = extractJsonObject(raw);
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const message = typeof o.message === 'string' ? o.message.trim() : '';
  if (message.length === 0) return null;
  const result: { message: string; emotion?: string } = { message };
  if (typeof o.emotion === 'string') result.emotion = o.emotion;
  return result;
}

import { nowLocalIso } from '../shared/datetime';
import { extractJsonObject } from '../shared/llm-parse';
import { log } from '../shared/logger';
import {
  DAILY_LIFE_CATEGORY,
  DAILY_LIFE_IMPORTANCE,
  EPISODIC_SUMMARY_MAX_CHARS,
} from '../shared/constants';
import { loadAllEpisodicFiles, saveEpisodic } from '../memory/episodic';
import { selectOpenLoops, loadOpenLoopState, saveOpenLoopState } from '../memory/open-loops';
import { indexEpisodic } from '../memory/index-inverted';
import type { LlmComplete } from '../memory/extractor';
import type { ActiveCharacter, CharacterContext } from '../shared/types/character';
import type { EpisodicMemory } from '../shared/types/memory';

// オフスクリーンライフ(P3・N-PRES-3)。「会っていない間も生きている」を成立させる。
//
// 起動時に1回 LLM を呼び、{greeting(挨拶), life(暮らしの断片)} を生成する。
//  - greeting: 経過・時間帯・近況を織り込んだ第一声(定型文の使い回し #11 を解消)。
//  - life: 「最後に話してから何をしていたか」の一文。これを provenance:'self' の episodic として**保存する**。
//    → 作話を許す代わりに**作話を固定**する。次回「昨日何してた?」に矛盾なく答えられる(#2/#3 の構造的解)。
//
// 安全策:
//  - 初回起動(出会いの日)は暮らしの既往が無いので生成しない(null=呼出側が firstLaunchGreeting を出す)。
//  - 同日2回目以降は断片を作らない(1日1個)。挨拶だけ生成する。
//  - 直近の断片を入力に渡し連続性を担保(昨日「風邪気味」→今日「マラソン」を防ぐ)。
//  - 生成/保存の失敗は会話に影響させない(呼出側が定型文へフォールバック)。

export interface OffscreenLifePrompt {
  system: string;
  user: string;
}

/** 生成プロンプトを組み立てる(純粋)。persona(systemPrompt)に近況・経過・連続性の材料を添える。 */
export function buildOffscreenLifePrompt(input: {
  systemPrompt: string;
  elapsedLabel?: string;
  timeOfDay: string;
  currentStatus?: string;
  currentHobbies?: string[];
  recentLife: string[];
  openLoops: string[];
  makeFragment: boolean;
}): OffscreenLifePrompt {
  const system = [
    input.systemPrompt,
    '',
    'あなたはいま起動して、画面に現れたところです。相手(いつもの話し相手)にかける第一声を考えます。',
    'あなたは「会っていない間も自分の生活を送っている一人の人」です。前回からの間に何をしていたかを思い描いてください。',
    '',
    '出力は次の JSON 1個のみ(前後に文章を付けない):',
    input.makeFragment
      ? '{"greeting": string, "life": string}'
      : '{"greeting": string}',
    '- greeting: あなたの口調の短い第一声。経過(下記)や時間帯に自然に触れてよい。長くしない。',
    input.makeFragment
      ? `- life: 前回からの間にあなたが過ごした出来事の一文(${EPISODIC_SUMMARY_MAX_CHARS}文字以内・あなた自身の生活。相手の話ではない)。下の「最近の暮らし」と矛盾させない。平凡で構わない。`
      : '',
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  const ctx: string[] = [`今は${input.timeOfDay}。`];
  if (input.elapsedLabel) ctx.push(`相手とは${input.elapsedLabel}。`);
  if (input.currentStatus) ctx.push(`あなたの近況: ${input.currentStatus}`);
  if (input.currentHobbies && input.currentHobbies.length > 0) {
    ctx.push(`最近の趣味: ${input.currentHobbies.join('、')}`);
  }
  if (input.recentLife.length > 0) {
    ctx.push('最近の暮らし(これと連続させる):', ...input.recentLife.map((l) => `- ${l}`));
  }
  if (input.openLoops.length > 0) {
    ctx.push('気にかけていること(挨拶で触れてもよい):', ...input.openLoops.map((l) => `- ${l}`));
  }
  return { system, user: ctx.join('\n') };
}

/** LLM 応答から greeting/life を取り出す(純粋)。greeting が無ければ null。 */
export function parseOffscreenLifeResponse(raw: string): { greeting: string; life?: string } | null {
  const obj = extractJsonObject(raw);
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const greeting = typeof o.greeting === 'string' ? o.greeting.trim() : '';
  if (greeting.length === 0) return null;
  const result: { greeting: string; life?: string } = { greeting };
  if (typeof o.life === 'string' && o.life.trim().length > 0) result.life = o.life.trim();
  return result;
}

/** 暮らしの断片を provenance:'self'・daily-life として保存する(忘却・想起の対象。canon とは別物)。 */
async function saveLifeFragment(life: string): Promise<void> {
  const memory: EpisodicMemory = {
    date: nowLocalIso(),
    topic: '日々の暮らし',
    summary: life.slice(0, EPISODIC_SUMMARY_MAX_CHARS),
    tags: [],
    entities: [],
    importance: DAILY_LIFE_IMPORTANCE,
    category: DAILY_LIFE_CATEGORY,
    provenance: 'self', // あなた自身の生活(「あなた自身の思い出」側に想起される)
    valence: 0, // 平凡な日常は心情を揺らさない
    disclosureLevel: 1,
  };
  const id = await saveEpisodic(memory);
  await indexEpisodic(id, memory);
}

/**
 * オフスクリーンライフを生成して挨拶を返す(P3)。失敗・初回は null(呼出側が定型文へフォールバック)。
 * @param complete LLM 呼び出し(makeLlmComplete を main が注入)。
 */
export async function generateOffscreenLife(
  charContext: CharacterContext,
  active: ActiveCharacter,
  elapsedLabel: string | undefined,
  timeOfDay: string,
  complete: LlmComplete,
): Promise<string | null> {
  // 出会いの日(初回)は暮らしの既往が無い=生成しない。
  if (!active.firstLaunchCompleted) return null;

  try {
    const all = await loadAllEpisodicFiles();
    const todayYmd = nowLocalIso().slice(0, 10);
    const dailyLife = all
      .filter((r) => r.memory.category === DAILY_LIFE_CATEGORY)
      .sort((a, b) => b.memory.date.localeCompare(a.memory.date));
    // 同日2回目以降は断片を増やさない(1日1個)。挨拶だけ作る。
    const makeFragment = !dailyLife.some((r) => r.memory.date.slice(0, 10) === todayYmd);
    const recentLife = dailyLife.slice(0, 3).map((r) => r.memory.summary);
    // 気にかけは会話・自発発話と同じ選択を通す(上限・休眠を共有)。挨拶が実際に作れたら下で履歴を保存する。
    const loopState = await loadOpenLoopState();
    const loopSel = selectOpenLoops(all, loopState, Date.now(), nowLocalIso());
    const openLoops = loopSel.notes;

    const prompt = buildOffscreenLifePrompt({
      systemPrompt: charContext.systemPrompt,
      elapsedLabel,
      timeOfDay,
      currentStatus: charContext.currentState?.currentStatus,
      currentHobbies: charContext.currentState?.currentHobbies,
      recentLife,
      openLoops,
      makeFragment,
    });

    const raw = await complete({ system: prompt.system, user: prompt.user, maxTokens: 512 });
    const parsed = parseOffscreenLifeResponse(raw);
    if (!parsed) return null;

    // 気にかけを挨拶で持ち出す機会を1回使った=履歴を保存(他経路と上限を共有・上限1で休眠)。
    if (loopSel.notes.length > 0) {
      try {
        await saveOpenLoopState({ surfaced: loopSel.surfaced });
      } catch (e) {
        log.warn('offscreen life open-loop state save failed', { name: (e as Error).name });
      }
    }

    if (makeFragment && parsed.life) {
      try {
        await saveLifeFragment(parsed.life);
      } catch (e) {
        log.warn('offscreen life fragment save failed', { name: (e as Error).name });
      }
    }
    return parsed.greeting;
  } catch (e) {
    // status を併記して原因を切り分け可能に(401=認証・undefined=接続/その他)。会話内容は出さない(§6.2)。
    log.warn('offscreen life generation failed', {
      name: (e as Error).name,
      status: (e as { status?: number }).status,
    });
    return null;
  }
}

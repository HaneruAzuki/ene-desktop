import { nowLocalIso, currentIsoWeekParts, isoWeekParts } from '../../shared/datetime';
import { log } from '../../shared/logger';
import { loadOpenLoopState, saveOpenLoopState } from '../../memory/open-loops';
import { readPresenceMemory } from '../../memory/presence-reads';
import { saveAndIndexEpisodic } from '../../memory/episodic-write';
import { deriveFamiliarityStage } from '../../memory/familiarity';
import { loadOffscreenPacks } from '../../memory/offscreen-life-pack';
import { selectWeeklyBeat, beatToEpisodic } from '../../memory/offscreen-life-select';
import type { LlmComplete } from '../../shared/types/llm';
import type { ActiveCharacter, CharacterContext } from '../../shared/types/character';

// オフスクリーンライフ(P3・N-PRES-3 / off-screen-life 本実装)。「会っていない間も生きている」を成立させる。
//
// 設計変更: 近況の作話を LLM にさせず、前もって書かれた**季節パック**から「今週の beat」を引いて
// daily-life として吸収する(作話の固定はパックが担う＝整合は執筆時に保証)。よって本関数は
// **挨拶の生成だけ**の単機能になり、life の生成・継続性ガード・JSON パースは消える(plan §10)。
//
// 段取り:
//  - 初回起動(出会いの日)は生成しない(null=呼出側が firstLaunchGreeting を出す)。
//  - 今週ぶんの beat を選び(フォールバック段は offscreen-life-select)、まだ今週吸収していなければ保存(1週1個)。
//  - 開示ゲート(§1.5): 挨拶に出す「最近の暮らし」は親しさ段階で濾し、深い記憶を初対面に出さない。
//  - 生成/保存の失敗は会話に影響させない(呼出側が定型文へフォールバック)。
//  - 重複判定は **未ゲートの dailyLife** で行う(深い beat も「今週吸収済み」を正しく数える)。
//
// ※ 気にかけ(open-loop)経路の開示ゲートは別増分(memory 系ファイルの編集が要るため後続)。

export interface OffscreenLifePrompt {
  system: string;
  user: string;
}

/** 挨拶生成プロンプトを組み立てる(純粋)。persona に経過・時間帯・今週の出来事・近況の材料を添える。 */
export function buildOffscreenLifePrompt(input: {
  systemPrompt: string;
  elapsedLabel?: string;
  timeOfDay: string;
  todayBeat?: string;
  selfLife: string[]; // あなた自身の最近の暮らし(provenance:self)
  userLife: string[]; // 相手について最近知ったこと(provenance:user)
  openLoops: string[];
}): OffscreenLifePrompt {
  const system = [
    input.systemPrompt,
    '',
    'あなたはいま起動して、画面に現れたところです。相手(いつもの話し相手)にかける第一声を考えます。',
    'あなたは「会っていない間も自分の生活を送っている一人の人」です。',
    '',
    '出力はあなたの口調の短い第一声(挨拶)だけ。前後に説明・記号・引用符を付けない。長くしない。',
    '経過(下記)・時間帯・最近の出来事に自然に触れてよいが、全部を盛り込まなくてよい。',
  ].join('\n');

  const ctx: string[] = [`今は${input.timeOfDay}。`];
  if (input.elapsedLabel) ctx.push(`相手とは${input.elapsedLabel}。`);
  if (input.todayBeat) ctx.push(`あなたが最近していたこと: ${input.todayBeat}`);
  // あなた自身の暮らしと「相手のこと」を明確に分ける(取り違え=相手の出来事を自分の挨拶ネタにしない・N-RECALL-1 と同方針)。
  if (input.selfLife.length > 0) {
    ctx.push('あなた自身の最近の暮らし(あなたが経験したこと):', ...input.selfLife.map((l) => `- ${l}`));
  }
  if (input.userLife.length > 0) {
    ctx.push('相手について最近知っていること(相手の出来事・あなたの経験ではない):', ...input.userLife.map((l) => `- ${l}`));
  }
  if (input.openLoops.length > 0) {
    ctx.push('気にかけていること(挨拶で触れてもよい):', ...input.openLoops.map((l) => `- ${l}`));
  }
  return { system, user: ctx.join('\n') };
}

/** LLM 応答から挨拶を取り出す(純粋)。素のテキスト(JSON ではない)。空なら null=定型文へ倒す。 */
export function parseGreeting(raw: string): string | null {
  const greeting = raw.trim();
  return greeting.length > 0 ? greeting : null;
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
    const nowIso = nowLocalIso();
    const nowMs = Date.now();
    const stage = deriveFamiliarityStage(active.relationship, nowMs);
    const { isoWeek, weekOfYear } = currentIsoWeekParts();

    // 最近の暮らし＋気にかけを memory の窓口から1回で得る(dailyLife は未ゲートで返る)。
    const loopState = await loadOpenLoopState();
    const { dailyLife, openLoops: loopSel } = await readPresenceMemory(loopState, nowMs, stage);

    // 今週ぶんの beat を選ぶ(パック→フォールバック段)。まだ今週吸収していなければ保存する(1週1個)。
    const absorbedThisWeek = dailyLife.some(
      (r) => isoWeekParts(new Date(r.memory.date)).isoWeek === isoWeek,
    );
    const packs = await loadOffscreenPacks();
    const selection = selectWeeklyBeat(packs, isoWeek, weekOfYear);
    let todayBeat: string | undefined;
    if (selection) {
      todayBeat = selection.beat.summary;
      if (!absorbedThisWeek) {
        try {
          await saveAndIndexEpisodic(beatToEpisodic(selection.beat, nowIso));
        } catch (e) {
          log.warn('offscreen beat absorb failed', { name: (e as Error).name });
        }
      }
    }

    // 挨拶で見せる「最近の暮らし」は開示ゲートで濾す(深い記憶を初対面に出さない・§1.5)。
    // provenance で「あなた自身の暮らし(self)」と「相手について知ったこと(user)」を分け、挨拶で取り違えない
    // (相手の試験を自分の暮らしとして/自分の試験を相手のものとして話す事故を防ぐ・N-RECALL-1 と同方針)。
    const gated = dailyLife.filter((r) => (r.memory.disclosureLevel ?? 1) <= stage);
    const selfLife = gated
      .filter((r) => r.memory.provenance === 'self')
      .slice(0, 3)
      .map((r) => r.memory.summary);
    const userLife = gated
      .filter((r) => r.memory.provenance !== 'self')
      .slice(0, 3)
      .map((r) => r.memory.summary);

    const prompt = buildOffscreenLifePrompt({
      systemPrompt: charContext.systemPrompt,
      elapsedLabel,
      timeOfDay,
      todayBeat,
      selfLife,
      userLife,
      openLoops: loopSel.notes,
    });

    const raw = await complete({ system: prompt.system, user: prompt.user, maxTokens: 256 });
    const greeting = parseGreeting(raw);
    if (!greeting) return null;

    // 気にかけを挨拶で持ち出す機会を1回使った=履歴を保存(他経路と上限を共有・上限1で休眠)。
    if (loopSel.notes.length > 0) {
      try {
        await saveOpenLoopState({ surfaced: loopSel.surfaced });
      } catch (e) {
        log.warn('offscreen life open-loop state save failed', { name: (e as Error).name });
      }
    }
    return greeting;
  } catch (e) {
    // status を併記して原因を切り分け可能に(401=認証・undefined=接続/その他)。会話内容は出さない(§6.2)。
    log.warn('offscreen life generation failed', {
      name: (e as Error).name,
      status: (e as { status?: number }).status,
    });
    return null;
  }
}

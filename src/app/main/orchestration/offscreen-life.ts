import { nowLocalIso, currentIsoWeekParts, isoWeekParts } from '../../../shared/datetime';
import { log } from '../../../shared/logger';
import { detectAiSelfReference } from '../../../shared/ai-self-check';
import { loadOpenLoopState, saveOpenLoopState } from '../../../memory/open-loops';
import { readPresenceMemory } from '../../../memory/readout/presence-reads';
import { saveAndIndexEpisodic } from '../../../memory/remember/episodic-write';
import { deriveFamiliarityStage } from '../../../memory/readout/familiarity';
import { loadOffscreenPacks } from '../../../offscreen-life/pack';
import { selectWeeklyBeat, beatToEpisodic } from '../../../offscreen-life/select';
import { buildOffscreenLifePrompt, parseGreeting } from '../../../conversation/offscreen-life-prompt';
import type { LlmComplete } from '../../../shared/types/llm';
import type { CharacterState, CharacterContext } from '../../../shared/types/character';

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


/**
 * オフスクリーンライフを生成して挨拶を返す(P3)。失敗・初回は null(呼出側が定型文へフォールバック)。
 * @param complete LLM 呼び出し(makeLlmComplete を main が注入)。
 */
export async function generateOffscreenLife(
  charContext: CharacterContext,
  active: CharacterState,
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

    // AI自称検知(第2層): 喋られる起動挨拶は本会話の検知ゲートを通らない。
    // 検知時は null=呼出側が定型挨拶へ倒す(第3層・再生成なし)。
    if (
      detectAiSelfReference(
        greeting,
        charContext.identity.selfRecognition.neverCallsSelf,
        charContext.language.selfRefTemplates,
      ).detected
    ) {
      log.warn('AI self-reference detected in greeting; falling back to templated');
      return null;
    }

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

import { getSemantic } from '../core/semantic';
import { getShortTerm } from '../core/short-term';
import { loadAllEpisodicFiles } from '../core/episodic';
import { loadLifeMemory } from '../core/life-memory';
import { retrieve, type RetrieverDeps } from '../recall/retriever';
import { seemsDown, LOW_MOOD_HINT } from './mood-cues';
import { deriveFamiliarityStage } from './familiarity';
import {
  selectOpenLoops,
  loadOpenLoopState,
  saveOpenLoopState,
  type OpenLoopState,
} from '../open-loops';
import { selectKnowledgeGaps } from './knowledge-gaps';
import { checkUserBirthdayToday } from './user-birthday';
import { loadOrCreateActiveCharacter } from '../../character/active-character';
import { log } from '../../shared/logger';
import { nowLocalIso, todayLocalYmd } from '../../shared/datetime';
import { timeOfDayLabel, describeElapsed, finitenessHint } from '../../shared/moment';
import {
  RECALL_DEBUG_ENV,
  OPEN_LOOP_GLOBAL_COOLDOWN_HOURS,
  KNOWLEDGE_GAP_COOLDOWN_HOURS,
  SELF_LOOP_COOLDOWN_HOURS,
  DAY_MS,
} from '../../shared/constants';
import type {
  MemoryContext,
  RetrievalQuery,
  EpisodicRecord,
  ConversationMoment,
  SemanticMemory,
} from '../../shared/types/memory';
import type { ActiveCharacter } from '../../shared/types/character';

// MemoryContext の組み立て(設計書 §3.3 / task_15 / task_16)。
// 長期(semantic)+ 短期(shortTerm)+ 関連する中期(retriever)を統合する。
// 想起は Router 非依存(ユーザー発言が引き金)。関心(interests)・開示(familiarityStage)は deps で注入する。

export async function buildMemoryContext(
  query: RetrievalQuery,
  deps: RetrieverDeps = {},
): Promise<MemoryContext> {
  const [semantic, shortTerm, relevantEpisodic] = await Promise.all([
    getSemantic(),
    getShortTerm(),
    retrieve(query, deps),
  ]);
  return { semantic, shortTerm, relevantEpisodic };
}

/**
 * 会話経路の記憶コンテキストを構築する(task_16 ＋ B-14a)。
 *
 * episodic(user)と canon を**1回だけ**ロードし、
 *  - 開示(familiarityStage):active-character の関係の事実から導出、
 *  - 想起プール(recallPool):user ＋ canon を retriever へ直接渡す(再ロードさせない)、
 * で使い回す。これにより、従来は開示の導出と retrieve(loadRecallPool)が別々に
 * 走らせていた loadAllEpisodicFiles を1回に削減する(レイテンシ・I/O の無駄取り)。
 *
 * now はここで確定(`Date.now()`)。テストは buildMemoryContext に deps を直接渡して決定化する。
 */
// セッション内のターン概算(有限性トーン P7 用)。プロセス寿命≈アプリ起動セッション=起動でリセット。
// 投機生成(コアレッシング)で多少過大計上しうるが、疲労は曖昧シグナルなので許容(N-PRES-7)。
let sessionTurnCount = 0;

export async function buildConversationMemory(
  query: RetrievalQuery,
  opts: { interests?: string[] } = {}, // トリミの関心キーワード(関心アフィニティ用・呼出側が charContext から渡す)
): Promise<MemoryContext> {
  const now = Date.now();
  sessionTurnCount += 1;
  const [userRecords, canon, active] = await Promise.all([
    loadAllEpisodicFiles(),
    loadLifeMemory(),
    loadOrCreateActiveCharacter(),
  ]);
  const stage = deriveFamiliarityStage(active.relationship, now);
  const deps: RetrieverDeps = {
    interests: opts.interests ?? [], // 関心アフィニティ
    familiarityStage: stage,
    rng: Math.random,
    recallPool: [...userRecords, ...canon],
  };
  const result = await buildMemoryContext(query, deps);
  result.moment = await buildMoment(userRecords, result.semantic, active, stage, sessionTurnCount);
  // 落ち込み対応(③b): 現在の発話に落ち込みの cue があれば、明るい話題へそっと寄せるヒントを載せる。
  if (seemsDown(query.text)) result.moment.lowMoodHint = LOW_MOOD_HINT;
  logRecallDiag(stage, canon, result.relevantEpisodic);
  return result;
}

/**
 * 「いま」の存在文脈を組み立てる(P1/P4/P5/P7・N-PRES-*)。会話経路でのみ呼ぶ(now は実時刻)。
 * 各要素は best-effort:失敗しても会話を止めない(揮発文脈が一部欠けるだけ)。
 */
async function buildMoment(
  userRecords: EpisodicRecord[],
  semantic: SemanticMemory,
  active: ActiveCharacter,
  stage: number,
  sessionTurns: number,
): Promise<ConversationMoment> {
  const d = new Date();
  const nowMs = d.getTime();
  const nowIso = nowLocalIso();
  const todayYmd = nowIso.slice(0, 10);

  // P4: 気にかけ(open-loops)/ P5: まだ知らないこと(knowledge-gaps)。⑥=毎ターン出すとツンデレが
  //   世話焼き化して崩れるため、**それぞれ独立したクールダウン**で間引く(気にかけ=6h / 学習=1日1回)。
  //   各クールダウン中はその種類を載せない。関連話題が出れば retriever 経路で自然に再訪する(別経路・対象外)。
  //   提示できた種類だけタイムスタンプを進める。失敗は握りつぶす。
  let openLoops: string[] = [];
  let selfOpenLoops: string[] = [];
  let knowledgeGaps: string[] = [];
  try {
    const state = await loadOpenLoopState();
    const cooled = (last: string | undefined, hours: number): boolean => {
      const t = last ? Date.parse(last) : NaN;
      return Number.isNaN(t) || nowMs - t >= (hours * DAY_MS) / 24;
    };
    let surfaced = state.surfaced;
    let lastOpenLoopAt = state.lastOpenLoopAt;
    let lastGapAt = state.lastGapAt;
    let lastSelfLoopAt = state.lastSelfLoopAt;
    let changed = false;

    // 相手の気にかけ(user・6h)とトリミ自身の気がかり(self・SELF_LOOP_COOLDOWN_HOURS=長め)は
    // **別クールダウン**。「不安」はデレと同じで薄く効かせる=self は user より稀に漏れる(案1)。
    const includeUser = cooled(state.lastOpenLoopAt, OPEN_LOOP_GLOBAL_COOLDOWN_HOURS);
    const includeSelf = cooled(state.lastSelfLoopAt, SELF_LOOP_COOLDOWN_HOURS);
    if (includeUser || includeSelf) {
      const sel = selectOpenLoops(userRecords, state, nowMs, stage, {
        user: includeUser,
        self: includeSelf,
      });
      openLoops = sel.notes;
      selfOpenLoops = sel.selfNotes;
      if (openLoops.length > 0 || selfOpenLoops.length > 0) surfaced = sel.surfaced;
      if (openLoops.length > 0) {
        lastOpenLoopAt = nowIso;
        changed = true;
      }
      if (selfOpenLoops.length > 0) {
        lastSelfLoopAt = nowIso;
        changed = true;
      }
    }
    if (cooled(state.lastGapAt, KNOWLEDGE_GAP_COOLDOWN_HOURS)) {
      knowledgeGaps = selectKnowledgeGaps(semantic, stage);
      if (knowledgeGaps.length > 0) {
        lastGapAt = nowIso;
        changed = true;
      }
    }
    if (changed) {
      const next: OpenLoopState = { surfaced };
      if (lastOpenLoopAt) next.lastOpenLoopAt = lastOpenLoopAt;
      if (lastGapAt) next.lastGapAt = lastGapAt;
      if (lastSelfLoopAt) next.lastSelfLoopAt = lastSelfLoopAt;
      await saveOpenLoopState(next);
    }
  } catch (e) {
    log.warn('proactive surfacing failed', { name: (e as Error).name });
  }

  const moment: ConversationMoment = {
    nowIso,
    timeOfDay: timeOfDayLabel(d.getHours()),
    userBirthdayToday: checkUserBirthdayToday(semantic, active, todayLocalYmd()),
  };
  const elapsed = describeElapsed(active.relationship?.lastConversationDate, todayYmd);
  if (elapsed) moment.elapsedLabel = elapsed;
  if (openLoops.length > 0) moment.openLoops = openLoops;
  if (selfOpenLoops.length > 0) moment.selfOpenLoops = selfOpenLoops;
  if (knowledgeGaps.length > 0) moment.knowledgeGaps = knowledgeGaps;
  const fin = finitenessHint(d.getHours(), sessionTurns);
  if (fin) moment.finitenessHint = fin;
  return moment;
}

/**
 * 想起の内訳を数値で記録する(切り分け診断・§6.2準拠=本文は出さず件数と provenance/開示段だけ)。
 * 「canon が想起されない」が(a)抽出失敗か(b)開示ゲートで除外か、を実機で区別するために使う。
 * canonPassGate = 現在の stage で開示ゲートを通過できる canon 件数(disclosureLevel ≤ stage)。
 */
function logRecallDiag(
  stage: number,
  canon: EpisodicRecord[],
  recalled: { provenance?: string; disclosureLevel?: number }[],
): void {
  if (process.env[RECALL_DEBUG_ENV] !== '1') return; // 既定オフ(opt-in 診断)
  const canonPassGate = canon.filter((r) => (r.memory.disclosureLevel ?? 1) <= stage).length;
  const recalledCanon = recalled.filter((m) => m.provenance === 'self');
  const levels = recalledCanon.map((m) => m.disclosureLevel ?? 1).join(',');
  log.info(
    `recall diag: stage=${stage} canonPool=${canon.length} canonPassGate=${canonPassGate} ` +
      `recalled=${recalled.length} (canon=${recalledCanon.length},user=${recalled.length - recalledCanon.length})` +
      (recalledCanon.length > 0 ? ` canonLevels=[${levels}]` : ''),
  );
}

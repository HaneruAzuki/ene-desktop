import { getSemantic } from '../core/semantic';
import { getShortTerm } from '../core/short-term';
import { loadAllEpisodicFiles } from '../core/episodic';
import { loadLifeMemory } from '../core/life-memory';
import { retrieve, type RetrieverDeps } from '../recall/retriever';
import { seemsDown, LOW_MOOD_HINT } from './mood-cues';
import { deriveFamiliarityStage } from './familiarity';
import { loadOrCreateActiveCharacter } from '../../character/active-character';
import { buildMoment, logRecallDiag } from './moment-builder';
import type { MemoryContext, RetrievalQuery } from '../../shared/types/memory';

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

// buildMoment(存在文脈の組成)・logRecallDiag(想起診断)は ./moment-builder へ分離した(公開前整理)。

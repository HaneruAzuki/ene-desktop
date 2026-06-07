import { getSemantic } from './semantic';
import { getShortTerm } from './short-term';
import { loadAllEpisodicFiles } from './episodic';
import { retrieve, type RetrieverDeps } from './retriever';
import { deriveMood } from './mood';
import { deriveFamiliarityStage } from './familiarity';
import { loadOrCreateActiveCharacter } from '../character/active-character';
import type { MemoryContext, RetrievalQuery } from '../shared/types/memory';

// MemoryContext の組み立て(設計書 §3.3 / task_15 / task_16)。
// 長期(semantic)+ 短期(shortTerm)+ 関連する中期(retriever)を統合する。
// 想起は Router 非依存(ユーザー発言が引き金)。心(mood)・開示(familiarityStage)は deps で注入する。

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
 * 会話経路用の想起 deps(心・開示・揺らぎ)を組み立てる(task_16)。
 *  - mood:直近の user episodic から導出(canon は含めない=loadAllEpisodicFiles は user のみ)。
 *  - familiarityStage:active-character の関係の事実から導出。
 *  - rng:softmax サンプリングの揺らぎ(Math.random)。
 * now はここで確定(`Date.now()`)。テストは retriever に直接 deps を渡して決定化する。
 */
export async function buildHeartDeps(): Promise<RetrieverDeps> {
  const now = Date.now();
  const [userRecords, active] = await Promise.all([
    loadAllEpisodicFiles(),
    loadOrCreateActiveCharacter(),
  ]);
  return {
    mood: deriveMood(userRecords, now),
    familiarityStage: deriveFamiliarityStage(active.relationship, now),
    rng: Math.random,
  };
}

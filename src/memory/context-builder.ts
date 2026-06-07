import { getSemantic } from './semantic';
import { getShortTerm } from './short-term';
import { retrieve } from './retriever';
import type { MemoryContext, RetrievalQuery } from '../shared/types/memory';

// MemoryContext の組み立て(設計書 §3.3 / task_15)。
// 長期(semantic)+ 短期(shortTerm)+ 関連する中期(retriever)を統合する。
// 関連中期の想起は Router 非依存(ユーザー発言を引き金に全件横断・design-revision-memory-v2 §1.5)。

export async function buildMemoryContext(query: RetrievalQuery): Promise<MemoryContext> {
  const [semantic, shortTerm, relevantEpisodic] = await Promise.all([
    getSemantic(),
    getShortTerm(),
    retrieve(query),
  ]);
  return { semantic, shortTerm, relevantEpisodic };
}

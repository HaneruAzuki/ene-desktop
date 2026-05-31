import { getSemantic } from './semantic';
import { getShortTerm } from './short-term';
import { searchEpisodic } from './episodic';
import type { MemoryContext, MemorySearchQuery } from '../shared/types/memory';

// MemoryContext の組み立て(設計書 §3.3)。
// 長期(semantic)+ 短期(shortTerm)+ 関連する中期(searchEpisodic)を統合する。

export async function buildMemoryContext(query: MemorySearchQuery): Promise<MemoryContext> {
  const [semantic, shortTerm, relevantEpisodic] = await Promise.all([
    getSemantic(),
    getShortTerm(),
    searchEpisodic(query),
  ]);
  return { semantic, shortTerm, relevantEpisodic };
}

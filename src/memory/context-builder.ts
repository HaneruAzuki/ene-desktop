import { getSemantic } from './semantic';
import { getShortTerm } from './short-term';
import { loadAllEpisodicFiles } from './episodic';
import { loadLifeMemory } from './life-memory';
import { retrieve, type RetrieverDeps } from './retriever';
import { deriveMood } from './mood';
import { deriveFamiliarityStage } from './familiarity';
import { loadOrCreateActiveCharacter } from '../character/active-character';
import { log } from '../shared/logger';
import { RECALL_DEBUG_ENV } from '../shared/constants';
import type { MemoryContext, RetrievalQuery, EpisodicRecord } from '../shared/types/memory';

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
 * 会話経路の記憶コンテキストを構築する(task_16 ＋ B-14a)。
 *
 * episodic(user)と canon を**1回だけ**ロードし、
 *  - 心(mood):直近の user episodic から導出(canon は含めない)、
 *  - 開示(familiarityStage):active-character の関係の事実から導出、
 *  - 想起プール(recallPool):user ＋ canon を retriever へ直接渡す(再ロードさせない)、
 * の3つで使い回す。これにより従来 buildHeartDeps と retrieve(loadRecallPool)で
 * 二重に走っていた loadAllEpisodicFiles を1回に削減する(レイテンシ・I/O の無駄取り)。
 *
 * now はここで確定(`Date.now()`)。テストは buildMemoryContext に deps を直接渡して決定化する。
 */
export async function buildConversationMemory(query: RetrievalQuery): Promise<MemoryContext> {
  const now = Date.now();
  const [userRecords, canon, active] = await Promise.all([
    loadAllEpisodicFiles(),
    loadLifeMemory(),
    loadOrCreateActiveCharacter(),
  ]);
  const stage = deriveFamiliarityStage(active.relationship, now);
  const deps: RetrieverDeps = {
    mood: deriveMood(userRecords, now),
    familiarityStage: stage,
    rng: Math.random,
    recallPool: [...userRecords, ...canon],
  };
  const result = await buildMemoryContext(query, deps);
  logRecallDiag(stage, canon, result.relevantEpisodic);
  return result;
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

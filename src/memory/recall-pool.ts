import { loadAllEpisodicFiles } from './episodic';
import { loadLifeMemory } from './life-memory';
import type { EpisodicRecord } from '../shared/types/memory';

// 想起プール(task_16)。ユーザー episodic と人生記憶 canon を統合した母集団。
// retriever・逆引き索引・ベクトル索引が共通で使い、canon も横断想起の対象に含める。
//
// 注意の分担:
// - 横断想起(語彙/ベクトル/RRF/開示)の母集団 = 本プール(user + canon)。
// - mood 導出・「直近×高importance」安全網 = user のみ(canon は直近の出来事ではない)。
//   → 呼び出し側(retriever/mood)が provenance で絞る。

export async function loadRecallPool(): Promise<EpisodicRecord[]> {
  const [user, canon] = await Promise.all([loadAllEpisodicFiles(), loadLifeMemory()]);
  return [...user, ...canon];
}

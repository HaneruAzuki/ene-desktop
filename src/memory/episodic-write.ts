import { saveEpisodic } from './episodic';
import { indexEpisodic } from './index-inverted';
import type { EpisodicMemory } from '../shared/types/memory';

// 中期記憶の書き込み窓口(memory 層の公開 facade)。
//
// なぜ分けるか(§4.4 旗艦例「検索方式を変えても上位は無変更」):
//   逆引き索引(index-inverted)は episodic 本体から再生成できる**派生キャッシュ=内部実装**。
//   保存と索引付けは必ずペアで起きる(索引漏れ=想起漏れ)ので、ここで束ねて一箇所にする。
//   層外(conversation 等)はこの窓口だけを使い、索引実装に直接触らない
//   (= .dependency-cruiser の no-index-impl-outside-memory で機械的に強制)。
//
// 循環回避メモ: episodic.ts へ置くと episodic→index-inverted→recall-pool→episodic の循環になるため、
//   依存の終端にあたる本モジュールに facade を置く。

/**
 * 中期記憶を1件保存し、逆引き索引へ反映する。
 * @returns 保存した記録の ID(ファイルパスが ID を兼ねる)。
 */
export async function saveAndIndexEpisodic(memory: EpisodicMemory): Promise<string> {
  const id = await saveEpisodic(memory);
  await indexEpisodic(id, memory);
  return id;
}

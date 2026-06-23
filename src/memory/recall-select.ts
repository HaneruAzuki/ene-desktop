import { RECALL_TOPIC_MAX } from '../shared/constants';
import type { EpisodicMemory, EpisodicRecord } from '../shared/types/memory';

// 想起の最終選抜(P2・多様性)。retriever のスコアリング後、返す件数を「トピックの偏り」を抑えて選ぶ純粋ロジック。
// I/O も乱数も持たない=決定論で単体テスト可能(retriever はこのモジュールへスコア済みの順序を渡すだけ)。
//
// なぜ要るか(精査 c):同じ話題を繰り返すと語彙/ベクトルの両アームがその話題に偏り、返り値が全部同じ話題で
// 埋まって「同じ話を繰り返す/固執する」ように見える。トピック上限で占有を断ち、別話題が候補にあれば差し込む。

/** 記憶のトピック鍵(多様性の単位)。topic が空なら category へ。表記ゆれは正規化(trim/小文字)。 */
export function topicKey(m: EpisodicMemory): string {
  return (m.topic || m.category || '').trim().toLowerCase();
}

/**
 * 関連順 orderedIds から limit 件を、同一トピックの占有を topicMax に抑えて選ぶ(P2)。
 *  1) 関連順に走査し、各トピック topicMax 件までで拾う(別話題に席を残す)。
 *  2) それでも limit に満たなければ、同じ順序を上限無視で走査して補充する(従来より少なく返さない)。
 * 返すのは byId で解決できた EpisodicRecord のみ。
 */
export function pickDiverse(
  orderedIds: string[],
  byId: Map<string, EpisodicRecord>,
  limit: number,
  topicMax: number = RECALL_TOPIC_MAX,
): EpisodicRecord[] {
  const picked: EpisodicRecord[] = [];
  const pickedIds = new Set<string>();
  const topicCount = new Map<string, number>();

  // 1) トピック上限つきの第一巡(関連順)。
  for (const id of orderedIds) {
    if (picked.length >= limit) break;
    const rec = byId.get(id);
    if (!rec || pickedIds.has(id)) continue;
    const key = topicKey(rec.memory);
    if ((topicCount.get(key) ?? 0) >= topicMax) continue;
    topicCount.set(key, (topicCount.get(key) ?? 0) + 1);
    picked.push(rec);
    pickedIds.add(id);
  }

  // 2) 不足分を上限無視で補充(別話題が枯れている=偏りではなく実際にその話題しか無い)。
  if (picked.length < limit) {
    for (const id of orderedIds) {
      if (picked.length >= limit) break;
      const rec = byId.get(id);
      if (!rec || pickedIds.has(id)) continue;
      picked.push(rec);
      pickedIds.add(id);
    }
  }

  return picked;
}

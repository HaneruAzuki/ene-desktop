import { log } from '../../shared/logger';
import { loadEpisodicById, updateEpisodicById } from '../core/episodic';
import { rebuildInvertedIndex } from '../core/index-inverted';
import type { Correction } from '../../shared/types/memory';

// 記憶の非破壊更新(supersede/refine/reattribute・task_15)。
// 物理削除はしない(ユーザー操作のみ・§6.4)。曖昧な人物分裂の一括再帰属はしない。

/**
 * corrections を適用する。
 * - supersede: 旧記録に supersededBy(= 新記録 ID)を付与。新記録 ID が無ければスキップ。
 * - refine: summary / entities を上書き(指定されたものだけ)。
 * - reattribute: その1件のみ帰属を直す(他の同名記録は触らない)。
 *   entities(人物の取り違え)と provenance(self↔user の取り違え・P1)のどちらか/両方を差し替える。
 *
 * 対象が見つからない/新記録 ID 不在などは黙ってスキップする(会話を妨げない・ベストエフォート)。
 * 1件でも適用したら逆引き索引を作り直す(entities/tags の変化を反映)。
 *
 * @param newRecordId supersede の置換先となる新記録の ID(同一抽出で保存された episodic の ID)
 * @returns 実際に適用した件数
 */
export async function applyCorrections(
  corrections: Correction[],
  newRecordId?: string,
): Promise<number> {
  let applied = 0;

  for (const c of corrections) {
    if (!c.targetFile) continue;
    // セキュリティ:targetFile は LLM 由来。パストラバーサル(".." 含み)は episodic.ts の
    // resolveEpisodicPath が throw するが、ここで先に弾いて best-effort のループを止めない
    // (1件の悪意ある targetFile が他の正当な correction を巻き込まないようにする)。
    if (c.targetFile.split(/[\\/]/).includes('..')) {
      log.warn(`correction skipped: invalid targetFile (path traversal)`);
      continue;
    }
    const target = await loadEpisodicById(c.targetFile);
    if (!target) {
      log.warn(`correction target not found: kind=${c.kind}`);
      continue;
    }

    if (c.kind === 'supersede') {
      if (!newRecordId) {
        // 置換先が無い supersede は適用しない(古い記録を宙づりにしない)。
        log.warn('supersede correction skipped: no new record id');
        continue;
      }
      await updateEpisodicById(c.targetFile, { supersededBy: newRecordId });
      applied++;
    } else if (c.kind === 'refine') {
      const patch: { summary?: string; entities?: string[] } = {};
      if (typeof c.newSummary === 'string') patch.summary = c.newSummary;
      if (Array.isArray(c.newEntities)) patch.entities = c.newEntities;
      if (Object.keys(patch).length === 0) continue;
      await updateEpisodicById(c.targetFile, patch);
      applied++;
    } else if (c.kind === 'reattribute') {
      // その1件のみ再帰属する(過去の同名記録を推測で一括変更しない)。
      // entities(人物)と provenance(self↔user・P1)の指定されたものだけ差し替える。
      const patch: { entities?: string[]; provenance?: 'user' | 'self' } = {};
      if (Array.isArray(c.newEntities)) patch.entities = c.newEntities;
      if (c.newProvenance === 'user' || c.newProvenance === 'self') patch.provenance = c.newProvenance;
      if (Object.keys(patch).length === 0) continue;
      await updateEpisodicById(c.targetFile, patch);
      applied++;
    }
  }

  if (applied > 0) await rebuildInvertedIndex();
  return applied;
}

import path from 'node:path';
import { getOffscreenLifeDir, getActiveCharacterId } from '../shared/node/paths';
import { listJsonFiles, readJson } from '../shared/node/json-store';
import { log } from '../shared/logger';
import type { OffscreenLifePack } from '../shared/types/offscreen-life';

// 画面の外の暮らし: 季節パック/常緑年の読み込み(I/O 窓口・off-screen-life)。
//
// 同梱(読取専用)の {characterId}/off-screen-life/*.json を全て読む(canon の life-memory.ts と同じく
// 「キャラ自身の暮らし」を memory faculty が所有する・(b)不変=character / (a)可変=memory の配置思想)。
// 純粋な週次選択は offscreen-life-select.ts(electron 非依存・テスト可能)に分離している。
// ※自動更新(ダウンロード)分の data/ マージは §4.2 改定後に別途(本実装は同梱パックのみ)。

/** 妥当なパックか(最低限の形検証)。壊れた1ファイルで全体を落とさない。 */
function isValidPack(p: OffscreenLifePack | null): p is OffscreenLifePack {
  return (
    p !== null &&
    Array.isArray(p.arcs) &&
    Array.isArray(p.beats) &&
    (p.kind === 'seasonal' || p.kind === 'evergreen')
  );
}

/**
 * 同梱の off-screen-life パックを全て読み込む。
 * 不在(パックを持たないキャラ)は空配列(後方互換)。壊れたファイルはスキップしてログのみ。
 */
export async function loadOffscreenPacks(
  characterId: string = getActiveCharacterId(),
): Promise<OffscreenLifePack[]> {
  const dir = getOffscreenLifeDir(characterId);
  const files = await listJsonFiles(dir);
  const packs: OffscreenLifePack[] = [];
  for (const file of files) {
    try {
      const raw = await readJson<OffscreenLifePack>(path.join(dir, file));
      if (isValidPack(raw)) {
        packs.push(raw);
      } else {
        log.warn('offscreen pack skipped (invalid shape)', { file });
      }
    } catch (e) {
      log.warn('offscreen pack load failed', { file, name: (e as Error).name });
    }
  }
  return packs;
}

import { loadAllEpisodicFiles } from './episodic';
import { selectOpenLoops } from './open-loops';
import { DAILY_LIFE_CATEGORY } from '../shared/constants';
import type { OpenLoopState, OpenLoopSelection } from './open-loops';
import type { EpisodicRecord } from '../shared/types/memory';

// 存在感(挨拶・自発発話)が必要とする中期記憶の読み取り窓口(memory 層の公開 facade)。
//
// なぜ分けるか(§4.4・書き込み側 [[episodic-write]] と対称):
//   `loadAllEpisodicFiles` は「全ファイルをディスクから読む」ストレージの読み取りプリミティブ。
//   これを層外(conversation / app)が直接掴むと、ストレージ実装(ファイル単位→DB・ページング等)を
//   変えた瞬間に上位が巻き込まれる。ここで「気にかけの選択」「最近の暮らし」という**意図単位**で公開し、
//   episodic ストアへの直接依存を memory 層内に閉じ込める(.dependency-cruiser の
//   no-episodic-store-outside-memory で機械強制)。
//   episodic 本体は**一度だけ**読み、両方を導出する(二重ロードを避ける)。

export interface PresenceMemory {
  /** 「日々の暮らし」(provenance:self の daily-life)を新しい順に。recentLife / makeFragment の素材。 */
  dailyLife: EpisodicRecord[];
  /** 今のターンで持ち出す「気にかけ」(open loop)の選択結果(notes / surfaced)。 */
  openLoops: OpenLoopSelection;
}

/**
 * 存在感の発話材料(最近の暮らし＋気にかけ)を1回のロードで読み出す。
 * @param state 「気にかけ」の能動提示履歴(共有用・呼出側が loadOpenLoopState で得る)。
 * @param nowMs 現在時刻(ms)。
 */
export async function readPresenceMemory(
  state: OpenLoopState,
  nowMs: number,
  stage: number = 5,
): Promise<PresenceMemory> {
  const all = await loadAllEpisodicFiles();
  // dailyLife は**未ゲート**で返す(挨拶の重複判定で深い beat も数えるため)。開示の濾しは表示側(recentLife)が行う。
  const dailyLife = all
    .filter((r) => r.memory.category === DAILY_LIFE_CATEGORY)
    .sort((a, b) => b.memory.date.localeCompare(a.memory.date));
  // 気にかけ(open-loops)は開示ゲート(§1.5): 親密度より深い気にかけは出さない(stage 未指定=全開示)。
  const openLoops = selectOpenLoops(all, state, nowMs, stage);
  return { dailyLife, openLoops };
}

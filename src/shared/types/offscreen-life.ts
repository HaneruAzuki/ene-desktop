// 画面の外の暮らし(off-screen-life)の型定義。
//
// 季節パック/常緑年の形(docs/off-screen-life-plan.md §8 / authoring-guide §2)。
// beat はキャラ自身の現在進行の暮らしの一コマで、保存時に EpisodicMemory(provenance:'self')へ変換される。
// 設計は plan、内容は bible、生成手順は authoring-guide を参照。

import type { OpenLoop } from './memory';

/** 続いていく関心事の縦糸(終端を持たない)。 */
export interface OffscreenArc {
  id: string;
  category: string;
  title: string;
  premise: string;
  cast: string[]; // canon の人物のみ
  neverEndsBecause: string;
  season: string;
}

/** アークの一コマ。週に1つだけ表に出る最小単位。EpisodicMemory から date を抜いた形＋週。 */
export interface OffscreenBeat {
  id: string;
  arcId: string;
  /** seasonal=ISO週文字列「2026-W27」 / evergreen=週-of-year 数値(1..53)。 */
  week: string | number;
  topic: string;
  summary: string; // 事実だけを terse に(口調は実行時 LLM が付与)
  tags?: string[];
  entities?: string[];
  importance?: number; // 1..5(基本 1〜2・3+ は稀)
  category?: string; // 既定 daily-life
  disclosureLevel?: number; // 1..5(既定 1)
  openLoop?: OpenLoop;
}

/** Xミラー文(週次の独白)。 */
export interface OffscreenTweet {
  week: string | number;
  text: string;
}

/** 季節パック/常緑年。工場(ショーランナー)が生成し、配布・同梱される。 */
export interface OffscreenLifePack {
  packVersion: string;
  season: string;
  kind: 'seasonal' | 'evergreen';
  coversWeeks?: [string, string]; // seasonal のみ(ISO週の範囲)
  seasonMood?: string; // 任意・1行(旧 currentStatus 相当)
  note?: string;
  arcs: OffscreenArc[];
  beats: OffscreenBeat[];
  tweets?: OffscreenTweet[];
}

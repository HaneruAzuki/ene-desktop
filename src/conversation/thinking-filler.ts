import { FILLER_MIN_CHARS } from '../shared/constants';
import type { RouterResult } from '../shared/types/router';
import type { DomainLevel } from '../shared/types/character';

// 思考フィラー(うーん…)の発火判定(task_18 Phase C・B-15連動)。
//
// 設計の憲法(optimization-backlog 冒頭): 思考フィラーは正当な機能=「人が考え込む種類の問い」で出す。
//   **尺・有無を遅延に合わせてチューニングしない**(遅延隠し禁止)。判別テスト=「一瞬で答えられても
//   それでもやるか?」YES なら正当。→ ここでは**問いの性質**だけで決める。
//
// キャラ(魚川トリミ・ツンデレ・IT得意): 得意分野(high)は得意げに即答=フィラー無し。困惑/拒否
//   (none/refuse)は即時反応=無し。ごく短い雑談も軽い=無し。**medium/low の substantive な問い・
//   相談/意見を求める問い**でだけ「うーん…」を挟む(考え込む)。純粋関数=単体テスト対象。

/** 考え込みうる(=即答でない)ドメイン。high=得意げ即答 / none=困惑 / refuse=拒否 は出さない。 */
const PONDER_DOMAINS: readonly DomainLevel[] = ['medium', 'low'];

/** 相談・意見を求める語(あれば短くても「考え込む問い」とみなす)。 */
const CONSULT_RE = /[?？]|どう思|どうし|どうすれ|どっち|どちら|相談|迷って|べきか|悩/;

/**
 * このターンで思考フィラーを出すべきか(純粋)。
 * - medium/low ドメイン かつ(substantive=FILLER_MIN_CHARS 以上 または 相談/意見系)→ true
 * - high(得意)/none(困惑)/refuse(拒否)/ごく短い雑談 → false
 */
export function shouldPlayThinkingFiller(routerResult: RouterResult, userText: string): boolean {
  if (!PONDER_DOMAINS.includes(routerResult.domain)) return false;
  const t = userText.trim();
  if (t.length < 2) return false;
  return t.length >= FILLER_MIN_CHARS || CONSULT_RE.test(t);
}

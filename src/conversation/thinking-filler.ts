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

/** 非相談の長文で「考え込む」対象とするドメイン(一般・不得手)。high=得意げに説明 / none=困惑 は除外。 */
const SUBSTANTIVE_DOMAINS: readonly DomainLevel[] = ['medium', 'low'];

/**
 * 相談・意見を求める語(=それ自体が「考え込む問い」)。これがあれば**topic 分類に関係なく**発火。
 * 理由: 相談・感情の発話(「どう思う」「悩んでてさ」等)は埋め込み判別が none/high 等に誤分類しがち。
 * 相談かどうかは**問いの"形"**で決まる(トピックではない)ので、ドメインに依存させない(設計憲法=問いの性質で決める)。
 * 「Python どう思う?」のような得意分野の"意見"も考え込む対象(=自分の見解を述べる前のひと呼吸)で許容。
 */
const CONSULT_RE = /[?？]|どう思|どうし|どうすれ|どっち|どちら|相談|迷っ|悩|べきか|意見|アドバイス/;

/**
 * このターンで思考フィラーを出すべきか(純粋)。
 * - refuse(拒否)→ 常に false(即時に断る)
 * - **相談・意見系**(CONSULT_RE)→ refuse 以外なら true(ドメイン非依存=誤分類に強い)
 * - 非相談でも medium/low の substantive(FILLER_MIN_CHARS 以上)→ true(一般話題を考え込む)
 * - それ以外(得意分野の非相談=得意げに説明 / 短い雑談 / 困惑)→ false
 */
export function shouldPlayThinkingFiller(routerResult: RouterResult, userText: string): boolean {
  if (routerResult.domain === 'refuse') return false; // 拒否は即時(うーん不要)
  const t = userText.trim();
  if (t.length < 2) return false;
  if (CONSULT_RE.test(t)) return true; // 相談の"形"=考え込む問い(ドメイン非依存)
  return SUBSTANTIVE_DOMAINS.includes(routerResult.domain) && t.length >= FILLER_MIN_CHARS;
}

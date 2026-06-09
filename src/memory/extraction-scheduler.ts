import { performance } from 'node:perf_hooks';
import { log } from '../shared/logger';
import { getUnextractedEntries } from './short-term';
import { extractFromShortTerm } from './extraction-trigger';
import { EXTRACTION_BATCH_THRESHOLD, SHORT_TERM_HARD_MAX } from '../shared/constants';
import type { LlmComplete } from './extractor';

// 記憶抽出のスケジューラ(B-01 / B-02・optimization-backlog / N-09-10)。
//
// 目的:抽出(中期/長期へまとめる Claude 呼び出し)を**会話の応答クリティカルパスから外す**。
// 設計の憲法(レイテンシと"間"の三原則・原則1「計算は常に最小化する」)に沿う、純粋な無駄取り。
//
//  - バックグラウンド実行:requestExtraction は fire-and-forget(呼出側は await しない)。
//  - 直列化ロック(inFlight):抽出は同時に1本だけ。走行中の要求は coalesce し、
//    サイクル末尾で「もう一度だけ」追走する(取りこぼし防止)。
//  - 閾値バッチ化(B-02):未抽出が EXTRACTION_BATCH_THRESHOLD 以上たまった時だけ発火。
//    毎メッセージ発火(=1件ずつ抽出)をやめ、コストを下げる。
//
// 終了時・孤児回収時は flushExtraction を使う(走行中を待ってから、閾値に関係なく残りを全部抽出)。

/** 走行中の抽出サイクル(なければ null)。直列化ロックの実体。 */
let inFlight: Promise<void> | null = null;
/** 走行中に追加の抽出要求が来たことを示すフラグ(coalesce 用)。 */
let pending = false;

/**
 * 未抽出が閾値以上たまっていれば、バックグラウンドで抽出サイクルを回す。
 * 既に走行中なら追走を予約(coalesce)するだけで、新たなサイクルは起こさない。
 *
 * 返り値の Promise は「現在の抽出サイクルの完了」を表す。
 * 本番の会話経路は **await しない**(レイテンシに影響させない)。テストは await して観測する。
 */
export function requestExtraction(complete: LlmComplete): Promise<void> {
  if (!inFlight) {
    inFlight = runCycle(complete);
  } else {
    pending = true;
  }
  const current = inFlight;
  // 誰も await しなくても unhandledRejection にしない(バックグラウンド実行のため)。
  void current.catch((e) => log.warn('background extraction failed', { name: (e as Error).name }));
  return current;
}

/**
 * 短期記憶の未抽出が SHORT_TERM_HARD_MAX に達していたら、**同期で**抽出して確実に減らす(採用(a))。
 * 通常は閾値バッチ抽出が追いつくため到達しない。到達=抽出が大幅に遅延/失敗している異常時の安全網で、
 * このときだけ会話経路で意図的にレイテンシを払って上限を死守する(記憶は失わない)。
 */
export async function enforceShortTermCap(complete: LlmComplete): Promise<void> {
  const unextracted = await getUnextractedEntries();
  if (unextracted.length < SHORT_TERM_HARD_MAX) return;
  log.warn(`short-term hard cap reached (${unextracted.length}); forcing synchronous extraction`);
  await flushExtraction(complete);
}

/**
 * 走行中の抽出を待ってから、残った未抽出を**閾値に関係なく全て**抽出する。
 * アプリ終了時・起動時の孤児回収で使う(呼出後に短期記憶を削除してよい状態にする)。
 */
export async function flushExtraction(complete: LlmComplete): Promise<void> {
  if (inFlight) {
    try {
      await inFlight;
    } catch {
      // 失敗は requestExtraction 側でログ済み。終了処理は止めない。
    }
  }
  // 終了時は閾値を無視して残り全部を抽出する(reason=shutdown)。
  await extractFromShortTerm('shutdown', complete);
}

/**
 * 1サイクル = 「閾値を満たす限り抽出を繰り返す」。
 * ただし1回の抽出ごとに pending を見て、外から来た追走要求がなければ抜ける。
 */
async function runCycle(complete: LlmComplete): Promise<void> {
  try {
    do {
      pending = false;
      const unextracted = await getUnextractedEntries();
      if (unextracted.length < EXTRACTION_BATCH_THRESHOLD) break;
      // 計測:抽出にかかった ms を残す。これは**会話の total には乗らない**(背景・B-01)ことを示す。
      const t = performance.now();
      await extractFromShortTerm('overflow', complete);
      log.info(`background extraction done in ${Math.round(performance.now() - t)}ms (off critical path)`);
    } while (pending);
  } finally {
    inFlight = null;
  }
}

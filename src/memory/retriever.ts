import {
  DEFAULT_RETRIEVAL_LIMIT,
  RRF_K,
  RECALL_BIAS_LAMBDA,
  RECALL_SOFTMAX_TEMP,
  RECALL_CANDIDATE_POOL,
} from '../shared/constants';
import { log } from '../shared/logger';
import { loadRecallPool } from './recall-pool';
import { queryInverted } from './index-inverted';
import { getDefaultEmbedder, isEmbeddingModelAvailable, type Embedder } from '../shared/node/embedder';
import { searchVectors, syncVectorIndex } from './index-vector';
import { clampMood } from './mood';
import type { EpisodicMemory, EpisodicRecord, RetrievalQuery } from '../shared/types/memory';

// 想起エンジン(task_15 RRF ＋ task_16 心・開示ゲーティング)。
// ユーザー発言を引き金に**想起プール(user episodic ＋ canon)**を全件横断で引く(Router 非依存)。
//  - 開示ゲーティング(task_16):familiarityStage 以下の記憶のみ候補(RRF の手前でハードフィルタ)。
//  - 心(task_16):RRF スコアに λ·clampedMood·valence を加算＋softmax サンプリング(揺らぎ)。
//  - **後方互換**:deps 未指定なら従来の決定論的挙動(mood=0・全開示・argmax)。

export interface RetrieverDeps {
  /** テスト用に埋め込み実装を差し替える。未指定なら既定(ruri)。 */
  embedder?: Embedder;
  /** 心情(-2..+2 目安)。未指定=0(バイアスなし)。 */
  mood?: number;
  /** 親しさ段階(1..5)。未指定=5(全開示=従来挙動)。 */
  familiarityStage?: number;
  /** softmax サンプリング用 RNG(0..1)。未指定=決定論(スコア降順)。 */
  rng?: () => number;
  /**
   * 想起プール(user episodic ＋ canon)を呼出側が事前ロードして渡す(B-14a)。
   * 未指定なら従来どおり loadRecallPool() で都度ロードする。
   * 会話経路では心の導出と想起で同じ episodic を共有し、二重ロードを避けるために使う。
   */
  recallPool?: EpisodicRecord[];
}

// ベクトル想起の自己回復つき一時停止(A5・N-RECALL-2)。
//   旧実装は失敗1回で恒久フラグを true にし、語彙のみへ**永久退化**していた(一過性のエンジン不調でも
//   プロセス再起動まで意味検索が死に、語彙フォールバックで無音劣化=気づけない)。
//   連続失敗が閾値を超えた時だけ一時停止し、停止中も一定間隔で1回試して自己回復する。成功で完全リセット。
let vectorFailureStreak = 0; // 連続失敗数(成功で 0)
let recallsWhilePaused = 0; // 一時停止後の想起回数(再試行間隔の計数)
const VECTOR_PAUSE_AFTER_FAILURES = 3; // 連続失敗がこれを超えたら一時停止(単発の一過性失敗では止めない)
const VECTOR_RETRY_INTERVAL = 20; // 一時停止中もこの回数ごとに1回試して回復を探る

/** importance 降順 → recency(date)降順。 */
function byImportanceThenRecency(a: EpisodicMemory, b: EpisodicMemory): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  return b.date.localeCompare(a.date);
}

function passesCategory(memory: EpisodicMemory, category?: string): boolean {
  return category === undefined || memory.category === category;
}

/** 複数の順位リストを RRF で合流し id→スコアを返す。 */
function rrfFuse(rankings: string[][], k: number): Map<string, number> {
  const score = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, idx) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return score;
}

/** softmax サンプリングで上位 k 件を非復元抽出する(温度小=上位安定)。 */
function softmaxSample(
  items: Array<{ id: string; score: number }>,
  k: number,
  temp: number,
  rng: () => number,
): string[] {
  const pool = [...items];
  const out: string[] = [];
  while (out.length < k && pool.length > 0) {
    const max = Math.max(...pool.map((p) => p.score));
    const exps = pool.map((p) => Math.exp((p.score - max) / temp));
    const sum = exps.reduce((a, b) => a + b, 0);
    let r = rng() * sum;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= exps[idx] ?? 0;
      if (r <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    out.push(pool[idx]?.id ?? '');
    pool.splice(idx, 1);
  }
  return out.filter((id) => id.length > 0);
}

async function tryVectorRanking(
  text: string,
  current: EpisodicRecord[],
  byId: Map<string, EpisodicRecord>,
  limit: number,
  injected?: Embedder,
): Promise<string[]> {
  const usingDefault = !injected;
  if (usingDefault) {
    // 連続失敗が閾値超え=一時停止中。ただし恒久ラッチにせず、一定間隔で1回だけ試して回復を探る(A5)。
    if (
      vectorFailureStreak >= VECTOR_PAUSE_AFTER_FAILURES &&
      recallsWhilePaused++ % VECTOR_RETRY_INTERVAL !== 0
    )
      return [];
    if (!(await isEmbeddingModelAvailable())) return [];
  }
  const embedder = injected ?? getDefaultEmbedder();
  try {
    const [queryVector] = await embedder.embed([text], 'query');
    if (!queryVector) return [];
    const index = await syncVectorIndex(current, embedder);
    // ここまで到達=埋め込み＋同期が成功=エンジン健全 → 失敗ストリークを完全リセット(自己回復)。
    if (usingDefault) {
      vectorFailureStreak = 0;
      recallsWhilePaused = 0;
    }
    if (index.entries.length === 0) return [];
    return searchVectors(queryVector, index, Math.max(limit * 4, 20))
      .map((s) => s.id)
      .filter((id) => byId.has(id));
  } catch (e) {
    if (usingDefault) {
      vectorFailureStreak += 1;
      // 停止に入る瞬間までは回数つきで警告し、停止後は黙る(ログ氾濫を防ぐ)。再試行で回復すれば上で reset。
      if (vectorFailureStreak <= VECTOR_PAUSE_AFTER_FAILURES)
        log.warn(
          `vector recall failed (${vectorFailureStreak}/${VECTOR_PAUSE_AFTER_FAILURES}), lexical only: ${(e as Error).name}`,
        );
      if (vectorFailureStreak === VECTOR_PAUSE_AFTER_FAILURES) recallsWhilePaused = 0;
    } else {
      log.warn(`vector recall unavailable, lexical only: ${(e as Error).name}`);
    }
    return [];
  }
}

export async function retrieveRecords(
  query: RetrievalQuery,
  deps: RetrieverDeps = {},
): Promise<EpisodicRecord[]> {
  const limit = query.limit ?? DEFAULT_RETRIEVAL_LIMIT;
  const stage = deps.familiarityStage ?? 5; // 未指定=全開示(後方互換)
  // 呼出側が事前ロードしたプールがあれば再ロードしない(B-14a: 二重ロード解消)。
  const all = deps.recallPool ?? (await loadRecallPool());

  // current(非 superseded・category・**開示段階内**)の母集団。
  const byId = new Map<string, EpisodicRecord>();
  for (const r of all) {
    if (r.memory.supersededBy) continue;
    if (!passesCategory(r.memory, query.category)) continue;
    // 開示ゲーティング(task_16)。これは **canon(トリミ自身の人生・provenance:'self')** を
    // 「親密度が上がるほど深い level まで打ち明ける」ための機構。user 記憶(相手が話したこと)は
    // 抽出器が level を付けず既定 1=**常に開示=意図的**(相手が話したことは親密度に関係なく覚えている。
    // そこにゲートをかけると"覚えていない"ように見える逆効果)。よって実質 canon にのみ効く=設計判断であって
    // 配線漏れではない(横断監査 disclosureLevel・2026-06-16 ユーザー確認)。
    if ((r.memory.disclosureLevel ?? 1) > stage) continue;
    byId.set(r.id, r);
  }
  const current = [...byId.values()];

  // 1) 語彙/entity ＋ 2) 意味(ベクトル)→ RRF 合流
  const lexicalRanked = (await queryInverted(query.text, query.entities))
    .map((id) => byId.get(id))
    .filter((r): r is EpisodicRecord => r !== undefined)
    .sort((a, b) => byImportanceThenRecency(a.memory, b.memory))
    .map((r) => r.id);
  const vectorRanked = await tryVectorRanking(query.text, current, byId, limit, deps.embedder);
  const rankings = vectorRanked.length > 0 ? [lexicalRanked, vectorRanked] : [lexicalRanked];
  const fused = rrfFuse(rankings, RRF_K);

  // 3) 心バイアス:finalScore = RRF + λ·clampedMood·valence(task_16)
  const clamped = clampMood(deps.mood ?? 0);
  const scored = [...fused.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, rrf]) => {
      const valence = byId.get(id)?.memory.valence ?? 0;
      return { id, score: rrf + RECALL_BIAS_LAMBDA * clamped * valence };
    });

  // 4) 上位選択。まずスコア上位 RECALL_CANDIDATE_POOL 件へ絞り(無関係な裾を除外=precision)、
  //    その中から RNG ありは softmax サンプリング(揺らぎ)、なしは決定論(スコア降順)。
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const candidates = ranked.slice(0, Math.max(limit, RECALL_CANDIDATE_POOL));
  const orderedIds = deps.rng
    ? softmaxSample(candidates, limit, RECALL_SOFTMAX_TEMP, deps.rng)
    : candidates.map((s) => s.id);

  const picked: EpisodicRecord[] = [];
  const pickedIds = new Set<string>();
  for (const id of orderedIds) {
    const rec = byId.get(id);
    if (!rec) continue;
    picked.push(rec);
    pickedIds.add(id);
    if (picked.length >= limit) break;
  }

  // 5) 安全網:不足分を「直近×高importance」で補完。**user のみ**(canon は直近の出来事ではない)。
  if (picked.length < limit) {
    const rest = current
      .filter((r) => !pickedIds.has(r.id) && r.memory.provenance !== 'self')
      .sort((a, b) => byImportanceThenRecency(a.memory, b.memory));
    for (const r of rest) {
      if (picked.length >= limit) break;
      picked.push(r);
    }
  }

  return picked.slice(0, limit);
}

/** 会話時の既定想起(Conversation Layer 向け・ID は落として記憶のみ返す)。 */
export async function retrieve(
  query: RetrievalQuery,
  deps: RetrieverDeps = {},
): Promise<EpisodicMemory[]> {
  return (await retrieveRecords(query, deps)).map((r) => r.memory);
}

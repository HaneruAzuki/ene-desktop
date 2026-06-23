import {
  DEFAULT_RETRIEVAL_LIMIT,
  RRF_K,
  RECALL_SOFTMAX_TEMP,
  RECALL_CANDIDATE_POOL,
  RECALL_TOPIC_MAX,
  INTEREST_AFFINITY_WEIGHT,
  CHEERUP_WEIGHT,
  USER_DOWN_THRESHOLD,
} from '../shared/constants';
import { pickDiverse } from './recall-select';
import { log } from '../shared/logger';
import { loadRecallPool } from './recall-pool';
import { queryInverted } from './index-inverted';
import { getDefaultEmbedder, isEmbeddingModelAvailable, type Embedder } from '../shared/node/embedder';
import { searchVectors, syncVectorIndex } from './index-vector';
import type { EpisodicMemory, EpisodicRecord, RetrievalQuery } from '../shared/types/memory';

// 想起エンジン(task_15 RRF ＋ 想起の個性化・開示ゲーティング)。
// ユーザー発言を引き金に**想起プール(user episodic ＋ canon)**を全件横断で引く(Router 非依存)。
//  - 開示ゲーティング:familiarityStage 以下の記憶のみ候補(RRF の手前でハードフィルタ)。
//  - 個性バイアス(2026-06-21):RRF に「関心アフィニティ＋元気づけ」を加算(旧 mood 機構を置換)。
//  - 上位 RECALL_CANDIDATE_POOL に絞って softmax サンプリング(揺らぎ・関連の裾を除外)。
//  - **後方互換**:deps 未指定なら従来挙動(関心/元気づけなし・全開示・argmax)。

export interface RetrieverDeps {
  /** テスト用に埋め込み実装を差し替える。未指定なら既定(ruri)。 */
  embedder?: Embedder;
  /** 相手のトーン(-2..+2 目安・recentUserTone)。負=落ち込み気味→元気づけ発火。未指定=0(発火しない)。 */
  recentUserTone?: number;
  /** トリミの関心キーワード(関心アフィニティ用)。未指定=[](関心ブーストなし)。 */
  interests?: string[];
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

/** interest 群が memory の topic/tags/entities と緩く一致するか(関心アフィニティの素・部分一致は割り切り)。 */
export function matchesInterest(memory: EpisodicMemory, interests: string[]): boolean {
  if (interests.length === 0) return false;
  const haystacks = [memory.topic, ...(memory.tags ?? []), ...(memory.entities ?? [])].filter(
    (s) => s.length > 0,
  );
  return interests.some((raw) => {
    const term = raw.trim();
    if (term.length === 0) return false;
    return haystacks.some((h) => h.includes(term) || term.includes(h));
  });
}

/** 関心アフィニティの加点(トリミの関心に触れる記憶へ・"自分の関心事に飛びつく")。 */
export function interestBoost(memory: EpisodicMemory, interests: string[]): number {
  return matchesInterest(memory, interests) ? INTEREST_AFFINITY_WEIGHT : 0;
}

/**
 * 元気づけの加点("相手の波長"・recentUserTone)。companion 向きに mood"逆"で効かせる。
 * 相手が落ち込み気味(tone < 閾値)のときだけ、相手が楽しそうに語った(user・正valence)記憶を引き上げる。
 * canon(自分の人生)・負/中立 valence には加点しない(片方向)。
 */
export function cheerupBoost(memory: EpisodicMemory, recentUserTone: number): number {
  if (recentUserTone >= USER_DOWN_THRESHOLD) return 0; // 落ち込んでいない→何もしない
  if (memory.provenance === 'self') return 0; // 自分の人生(canon)は元気づけに使わない
  const v = memory.valence ?? 0;
  return v > 0 ? CHEERUP_WEIGHT * v : 0; // 正valence(=相手が楽しそうに語った)だけ
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

  // 3) 個性バイアス:finalScore = RRF + 関心アフィニティ + 元気づけ(2026-06-21・旧 mood 機構を置換)
  const recentTone = deps.recentUserTone ?? 0;
  const interests = deps.interests ?? [];
  const scored = [...fused.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, rrf]) => {
      const memory = byId.get(id)?.memory;
      const bias = memory ? interestBoost(memory, interests) + cheerupBoost(memory, recentTone) : 0;
      return { id, score: rrf + bias };
    });

  // 4) 上位選択。まずスコア上位 RECALL_CANDIDATE_POOL 件へ絞り(無関係な裾を除外=precision)、
  //    その中で順序を決める(RNG ありは softmax で揺らし、なしは決定論=スコア降順)。
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const candidates = ranked.slice(0, Math.max(limit, RECALL_CANDIDATE_POOL));
  // softmax は limit 件でなく候補**全体**の順序付けに使う(多様性選抜へ全候補を渡すため)。
  const orderedIds = deps.rng
    ? softmaxSample(candidates, candidates.length, RECALL_SOFTMAX_TEMP, deps.rng)
    : candidates.map((s) => s.id);

  // 5) 多様性選抜(P2):同一トピックの占有を抑えて limit 件を選ぶ(偏り防止・純粋ロジック)。
  const picked = pickDiverse(orderedIds, byId, limit, RECALL_TOPIC_MAX);
  const pickedIds = new Set(picked.map((r) => r.id));

  // 6) 安全網:不足分を「直近×高importance」で補完。**user のみ**(canon は直近の出来事ではない)。
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

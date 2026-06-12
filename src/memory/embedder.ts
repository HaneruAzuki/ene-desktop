import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { log } from '../shared/logger';
import { getModelsDir } from '../shared/node/paths';
import {
  EMBEDDING_MODEL_DIR,
  EMBEDDING_QUERY_PREFIX,
  EMBEDDING_DOCUMENT_PREFIX,
} from '../shared/constants';

// ローカル埋め込み(ruri-v3-310m・ONNX・Phase B)。
//
// 重要(§7.1 厳守): アプリ実行時に外部へモデルを取りに行かない。
//   - env.allowRemoteModels = false でローカル限定にする。
//   - モデルは別ダウンロード(scripts/download-model.mjs)で data/models/ruri-v3-310m に配置。
//   - 未配置/ロード失敗時は例外を投げ、呼び出し側(retriever)が語彙のみへフォールバックする。
//
// transformers.js は ESM・ネイティブ依存(onnxruntime-node)を含むため遅延 import する
// (起動コストを避け、未使用経路で読み込まない)。

export type EmbeddingKind = 'query' | 'document';

export interface Embedder {
  /** texts をベクトル化して返す(行=テキスト・列=次元)。 */
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}

// 最小限の呼び出しシグネチャ。lib のオーバーロード型は広く、本用途には過剰なため絞る。
type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

async function loadExtractor(): Promise<FeatureExtractor> {
  const { pipeline, env } = await import('@huggingface/transformers');
  // ローカル限定(実行時に HuggingFace 等へ取りに行かない)。
  env.allowRemoteModels = false;
  env.localModelPath = getModelsDir();
  log.info(`loading embedding model from ${getModelsDir()}/${EMBEDDING_MODEL_DIR}`);
  // int8 量子化(約315MB)を基本に。モデルディレクトリ名で localModelPath 配下を解決。
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_DIR, { dtype: 'q8' });
  return extractor as unknown as FeatureExtractor;
}

function prefixOf(kind: EmbeddingKind): string {
  // ruri は入力プレフィックス必須(付け忘れ＝精度劣化)。
  return kind === 'query' ? EMBEDDING_QUERY_PREFIX : EMBEDDING_DOCUMENT_PREFIX;
}

/**
 * モデル本体が配置済みか(config.json の存在で判定)。
 * 未配置なら呼び出し側はベクトル経路を使わず語彙のみで動く(モデル無しでもアプリは成立)。
 */
export async function isEmbeddingModelAvailable(): Promise<boolean> {
  try {
    await fs.access(join(getModelsDir(), EMBEDDING_MODEL_DIR, 'config.json'));
    return true;
  } catch {
    return false;
  }
}

/** クエリ埋め込みの簡易キャッシュ(B-14c)。同一クエリの再埋め込み(リトライ/連投)を省く。 */
const QUERY_CACHE_MAX = 32;
const queryCache = new Map<string, number[]>();

/** 実推論(モデル遅延ロード→特徴抽出)。 */
async function runEmbed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
  if (!extractorPromise) extractorPromise = loadExtractor();
  const extractor = await extractorPromise;
  const prefixed = texts.map((t) => prefixOf(kind) + t);
  const output = await extractor(prefixed, { pooling: 'mean', normalize: true });
  return output.tolist();
}

/** 既定の埋め込み実装(遅延ロード・シングルトン・クエリは LRU 風キャッシュ)。 */
export function getDefaultEmbedder(): Embedder {
  return {
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      // 会話のクエリ(単一)はキャッシュ対象(B-14c)。文書埋め込み(複数・index sync)は素通し。
      if (kind === 'query' && texts.length === 1) {
        const key = texts[0] ?? '';
        const hit = queryCache.get(key);
        if (hit) return [hit];
        const [vec] = await runEmbed([key], 'query');
        if (!vec) return [];
        queryCache.set(key, vec);
        if (queryCache.size > QUERY_CACHE_MAX) {
          const oldest = queryCache.keys().next().value;
          if (oldest !== undefined) queryCache.delete(oldest);
        }
        return [vec];
      }
      return runEmbed(texts, kind);
    },
  };
}

/**
 * 埋め込みモデルを起動時にウォームする(B-14c)。初回の想起ターンに乗っていた
 * モデル遅延ロードの停止(数百ms〜数秒)を、起動時の背景処理へ前倒しして消す。
 * best-effort:モデル未配置なら何もしない(語彙のみで会話は成立)。失敗しても会話に影響しない。
 */
export async function warmEmbedder(): Promise<void> {
  try {
    if (!(await isEmbeddingModelAvailable())) return;
    await getDefaultEmbedder().embed(['ウォームアップ'], 'query');
    log.info('embedding model warmed');
  } catch (e) {
    log.warn('embedding warm failed', { name: (e as Error).name });
  }
}

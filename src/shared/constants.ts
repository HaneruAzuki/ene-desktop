// アプリ横断の定数(設計書 §3.3 ほか)。
// マジックナンバーを散らさず一元管理する(CLAUDE §4.5)。

// --- 記憶レイヤー ---
/** 短期記憶の最大保持件数(超過時に抽出→トリム)。設計書 §3.3。 */
export const SHORT_TERM_MAX_ENTRIES = 20;

/** Episodic 検索のデフォルト取得件数。要件 F-MEM-F-05。 */
export const DEFAULT_EPISODIC_SEARCH_LIMIT = 5;

/** Episodic summary の文字数上限の目安。設計書 §3.4 / F-MEM-E-06。 */
export const EPISODIC_SUMMARY_MAX_CHARS = 200;

/** Episodic importance の範囲(1〜5・整数)。F-MEM-E-06。 */
export const IMPORTANCE_MIN = 1;
export const IMPORTANCE_MAX = 5;
/** importance が不正値だった場合の既定値。 */
export const IMPORTANCE_DEFAULT = 3;

/** Episodic スキーマの現行バージョン(新規保存時に付与)。design-revision-memory-v2 §1.1。 */
export const EPISODIC_SCHEMA_VERSION = 2;

/** 想起(MemoryRetriever)のデフォルト取得件数。 */
export const DEFAULT_RETRIEVAL_LIMIT = 5;

// --- 埋め込み・ベクトル想起(Phase B・task_15 / design-revision-memory-v2 §1.3) ---

/** 埋め込みモデル(ruri-v3-310m)のディレクトリ名。data/models/ 配下に別ダウンロードで配置。 */
export const EMBEDDING_MODEL_DIR = 'ruri-v3-310m';

/** ruri の埋め込み次元(768)。 */
export const EMBEDDING_DIM = 768;

/** ruri は入力にプレフィックス必須(付け忘れ＝精度劣化)。クエリ用・文書用。 */
export const EMBEDDING_QUERY_PREFIX = '検索クエリ: ';
export const EMBEDDING_DOCUMENT_PREFIX = '検索文書: ';

/** RRF(Reciprocal Rank Fusion)の平滑化定数。一般に 60 が無難。 */
export const RRF_K = 60;

// --- ウィンドウ(設計書 §8.1) ---
/** キャラ部分のウィンドウ幅。 */
export const WINDOW_WIDTH = 240;
/** キャラ部分のウィンドウ高さ。 */
export const WINDOW_HEIGHT = 320;
/** 画面端からの既定マージン(初回配置・右下)。 */
export const WINDOW_EDGE_MARGIN = 20;

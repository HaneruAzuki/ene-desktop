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

// --- 音声入力(STT・task_17 Phase B) ---

/** STT モデル(whisper-large-v3-turbo・ONNX)のディレクトリ名。data/models/ 配下に別DLで配置。 */
export const STT_MODEL_DIR = 'whisper-large-v3-turbo';

/** Whisper が前提とするサンプリングレート(16kHz 固定)。マイク取得もこのレートで行う。 */
export const STT_SAMPLE_RATE = 16000;

/** 認識言語(日本語固定)。短い発話での言語自動判定のブレを防ぐ。 */
export const STT_LANGUAGE = 'japanese';

// --- 音声区間検出(VAD・ハンズフリー・task_17 Phase C) ---
// Silero VAD v4(resources/silero_vad.onnx・onnxruntime-node)。
// ★ v5 は onnxruntime-node で誤計算するため v4 を採用(N-17-9)。

/** resources/ 配下の Silero VAD モデルファイル名(配布物に同梱)。 */
export const VAD_MODEL_FILE = 'silero_vad.onnx';

/** Silero が要求する 16kHz の1フレーム長(サンプル数)。マイクもこの粒度で送る。 */
export const VAD_FRAME_SIZE = 512;

/** 発話判定の上側しきい値(これ以上で「話している」)。実機検証で 0.5 が speech/silence をクリーン分離。 */
export const VAD_SPEECH_THRESHOLD = 0.5;
/** 発話終了側の下側しきい値(ヒステリシス・チャタリング防止)。 */
export const VAD_SILENCE_THRESHOLD = 0.35;

/** 話し終わり(ターン終了)とみなす無音継続時間(ms)。「間のあるENE」哲学に合わせ気持ち長め。 */
export const VAD_MIN_SILENCE_MS = 700;
/** 発話開始の確定に必要な最小発話継続(ms)。単発ノイズでの誤発火を防ぐ。 */
export const VAD_MIN_SPEECH_MS = 160;
/** 切り出し時に発話頭へ付ける先読みパディング(ms)。語頭の欠けを防ぐ。 */
export const VAD_SPEECH_PAD_MS = 200;
/** barge-in(ENE発話中の割り込み)確定に必要な発話継続(ms)。エコー残響での誤割り込みを抑えるため長め。 */
export const VAD_BARGE_IN_MIN_SPEECH_MS = 320;

// --- 心・開示ゲーティング(task_16 / design-revision-character-heart §6) ---

/** 心情導出の時定数(日)。負は速く減衰=復元力(非対称)。 */
export const MOOD_TAU_POS_DAYS = 14;
export const MOOD_TAU_NEG_DAYS = 7;

/** clampedMood の下限(“デレの床”・暗転ロック回避・倫理の一線)。 */
export const MOOD_FLOOR = -1.5;

/**
 * 中立プライアの重み。mood を 0 へ向けて縮約する仮想的な“中立の記憶”。
 * これにより (a) 沈黙(記憶が古い)で mood が自然に 0 へ戻る(§3.2)、
 * (b) 数件の直近記憶では mood が小さい(微細)、という性質が出る。
 */
export const MOOD_PRIOR_WEIGHT = 1;

/** 想起バイアス係数。RRF スコアと同オーダーで「微細」(拮抗時のみ順位が動く・調律可)。 */
export const RECALL_BIAS_LAMBDA = 0.01;

/** 想起の softmax サンプリング温度(小さいほど上位が安定・調律可)。 */
export const RECALL_SOFTMAX_TEMP = 0.01;

/**
 * 開示ゲーティングの段階閾値(接触の事実3要素・連言・Lv5≈1年)。
 * 経過日数 AND 会話実日数 AND ターン累計の全部が満たされた最大段になる。
 */
export const FAMILIARITY_THRESHOLDS: ReadonlyArray<{
  stage: number;
  days: number;
  talkDays: number;
  turns: number;
}> = [
  { stage: 2, days: 3, talkDays: 2, turns: 10 },
  { stage: 3, days: 30, talkDays: 12, turns: 80 },
  { stage: 4, days: 120, talkDays: 40, turns: 350 },
  { stage: 5, days: 365, talkDays: 80, turns: 800 },
];

// --- ウィンドウ(設計書 §8.1) ---
// task_13: 全身立ち絵(比≈0.65)を中央帯に置き、上=吹き出し余白/下=入力欄余白を確保する縦長窓。
// キャラ表示帯 ≈ 368px(幅 260 で contain → 約 239×368)＋上余白100＋下余白52 = 520。
/** キャラ部分のウィンドウ幅。 */
export const WINDOW_WIDTH = 260;
/** キャラ部分のウィンドウ高さ。 */
export const WINDOW_HEIGHT = 520;
/** 画面端からの既定マージン(初回配置・右下)。 */
export const WINDOW_EDGE_MARGIN = 20;

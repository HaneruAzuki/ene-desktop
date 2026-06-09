// アプリ横断の定数(設計書 §3.3 ほか)。
// マジックナンバーを散らさず一元管理する(CLAUDE §4.5)。

// --- 記憶レイヤー ---
/** 短期記憶の最大保持件数(超過時に抽出→トリム)。設計書 §3.3。 */
export const SHORT_TERM_MAX_ENTRIES = 20;

/**
 * 記憶抽出をバッチ発火する未抽出エントリ数のしきい値(B-02)。
 * 毎メッセージ発火(=1件ずつ抽出)をやめ、未抽出がこの件数たまった時だけ
 * バックグラウンド抽出を1回回す。コスト削減＋まとまった文脈で episodic 化しやすくなる。
 * 5〜10 が目安(optimization-backlog B-02)。値は体感・コストで調律可。
 */
export const EXTRACTION_BATCH_THRESHOLD = 8;

/**
 * 短期記憶の未抽出件数のハード上限(採用(a)・2026-06-09 ユーザ決定)。
 * B-01 で「未抽出は捨てない」方針にしたため、抽出が長時間止まると短期が無制限に膨らむ縁がある。
 * 未抽出がこの件数に達したら、会話経路で**同期抽出を1回強制**して確実に減らす(上限を守りつつ記憶も失わない)。
 * 通常運用では到達しない安全網(到達は抽出が大幅に遅延/失敗している異常時のみ)。
 */
export const SHORT_TERM_HARD_MAX = 80;

// --- 忘却機構(B-13 / 設計書 §11.6・段階的記憶縮退) ---
// 中期記憶(Episodic)が青天井に増えないよう、月次/年次に再要約＋低重要度を物理削除して
// 常時 ≤1000 件に収める恒久ガバナ。**破壊的処理(物理削除)のため既定はオフ**
// (環境変数 ENE_FORGETTING=1 で有効化・実データ前にレビュー)。

/** 忘却機構を有効化する環境変数名(値 "1" で ON)。既定は無効(安全側)。 */
export const FORGETTING_ENABLED_ENV = 'ENE_FORGETTING';

/**
 * 音声ストリーミング(B-06・第一声短縮)を有効化する環境変数名(値 "1" で ON)。
 * 既定は無効(安全側)=従来の非ストリーミング合成。会話の最重要パスのため、
 * 実機(実 Claude streaming＋TTS＋renderer)での検証後に既定 ON へ切り替える。
 * ストリーミングが失敗した場合は非ストリーミング経路へフォールバックする(配線は壊れない)。
 */
export const VOICE_STREAMING_ENABLED_ENV = 'ENE_VOICE_STREAMING';

/** 想起の内訳を毎ターン記録する診断ログの有効化環境変数(値 "1" で ON)。既定オフ=通常ログを汚さない。 */
export const RECALL_DEBUG_ENV = 'ENE_DEBUG_RECALL';
/** 月次サマリ時に物理削除する importance の上限(これ以下を削除・§11.6)。 */
export const FORGET_MONTHLY_DELETE_IMPORTANCE_MAX = 2;
/** 年次サマリ時に物理削除する importance の上限(これ以下を削除・重要度≥4のみ詳細を残す)。 */
export const FORGET_YEARLY_DELETE_IMPORTANCE_MAX = 3;
/** 月次サマリ記録に付ける importance(想起での存在感。サマリの削除は別ロジック)。 */
export const FORGET_MONTHLY_SUMMARY_IMPORTANCE = 4;
/** 年次サマリ記録に付ける importance。 */
export const FORGET_YEARLY_SUMMARY_IMPORTANCE = 5;
/** 年 Y を年次サマリへ巻き上げる経過年数(currentYear - Y がこれ以上で年次対象=「1〜5年」帯)。 */
export const FORGET_YEARLY_AGE_YEARS = 2;
/** サマリ記録を格納する専用カテゴリ(実記録のカテゴリと衝突しない・ファイルパス上も分離)。 */
export const FORGET_SUMMARY_CATEGORY = 'summary';
/** 月次サマリ記録の合成日アンカー(月内固定日・ファイル名衝突回避)。 */
export const FORGET_MONTHLY_SUMMARY_DAY = 15;

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

/**
 * 話し終わり(ターン終了)とみなす無音継続時間(ms)。
 * これは**ハンズフリーの"見えないレイテンシ"**=喋り終わってから処理が始まるまでの死に時間そのもの。
 * 体感改善のため 700→500 に短縮(2026-06-09)。下限は BACKCHANNEL_PAUSE_TRIGGER_MS(400)より大きく保つこと
 * (ターン終了と相槌の言いよどみを区別するため)。短くしすぎると言いよどみを誤確定して食い気味になる。
 */
export const VAD_MIN_SILENCE_MS = 500;
/** 発話開始の確定に必要な最小発話継続(ms)。単発ノイズでの誤発火を防ぐ。 */
export const VAD_MIN_SPEECH_MS = 160;
/** 切り出し時に発話頭へ付ける先読みパディング(ms)。語頭の欠けを防ぐ。 */
export const VAD_SPEECH_PAD_MS = 200;
/** barge-in(ENE発話中の割り込み)確定に必要な発話継続(ms)。エコー残響での誤割り込みを抑えるため長め。 */
export const VAD_BARGE_IN_MIN_SPEECH_MS = 320;

// --- 能動的リスニング(相槌エンジン・task_18 Phase A) ---
// 既存 VAD の発話確率列(silero-vad / vad-segmenter)に相乗りして、
// 「持続発話 → 短い言いよどみ(turn-end より手前)」を相槌のスロットとして検出する。
// 値は「良い聞き手とは」で決める。**Claude が返るまでの時間では決めない**(設計の憲法・task_18)。

// 値は「落ち着いた聞き手(前のめりにならない)」を狙ってチューニング(2026-06-09 実機試聴・ユーザー)。
/** 最初の相槌を打つまでに必要な持続発話(ms)。長めにして「前のめり」を抑える。 */
export const BACKCHANNEL_MIN_SPEECH_MS = 2000;
/** 相槌の最小間隔(ms・頻度ガバナ)。広めにして打ちすぎ(うるさい・機械的)を防ぐ。 */
export const BACKCHANNEL_MIN_INTERVAL_MS = 4500;
/**
 * 言いよどみ(発話中の短い無音)が相槌スロットとみなされる継続(ms)。
 * 必ず VAD_MIN_SILENCE_MS(=ターン終了)より小さくする(ターン終了は相槌でなく応答の入り)。
 * 大きめにして微小な息継ぎに反応しない=落ち着いた相づちにする。
 */
export const BACKCHANNEL_PAUSE_TRIGGER_MS = 400;
/** 相槌の発話速度倍率(neutral 比)。1未満=少しゆっくり=機械的さを和らげ気持ち長く。 */
export const BACKCHANNEL_SPEED_SCALE = 0.92;
/**
 * 相槌の型を韻律(声の勢い)で出し分ける閾値(task_18 Lv2)。
 * いまの発話ピーク / 典型的な発話ピーク(文単位の長期平均) がこれ以上=強調・興奮 → surprise(へえ/えっ)。
 * 未満 → continuer(うん)。同レベルなら≈1.0、実機ログで興奮時の絶対ピークは平常の≈1.6倍。
 * **実機ログ(ratio=…)で平坦/興奮の実値の間に調律する**。
 */
export const BACKCHANNEL_EMPHASIS_RATIO = 1.4;
/**
 * 相槌の型をピッチ(声の高さ)で出し分ける閾値(task_18 Lv2・主信号)。
 * いまの発話ピッチ山 / 典型的な発話ピッチ山(文単位の長期平均) がこれ以上=興奮 → surprise。
 * 興奮で声が高くなる(大きさより安定した信号)。emphasisRatio(エネルギー)との OR で判定。
 * **実機ログ(pRatio=…)で平常/興奮の実値の間に調律する**。
 */
export const BACKCHANNEL_PITCH_RATIO = 1.2;

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

// --- 音声合成エンジン(AivisSpeech サイドカー・task_17 / N-17-6・N-17-12) ---
// エンジン本体は配布物(exe)に同梱せず data/voice/engine/ に別配置(コア<100MB維持・§4.3)。
// 起動時にアプリが run.exe を spawn(shell:false)してヘルス確認、終了時に kill する。

/** data/voice/ 配下のエンジン配置ディレクトリ名。 */
export const VOICE_ENGINE_DIR = 'engine';
/** AivisSpeech-Engine の実行ファイル名(run.exe 一式と engine_internal/・resources/ が同階層)。 */
export const VOICE_ENGINE_EXE = 'run.exe';
/** サイドカーの待受ホスト(ローカル固定・外部公開しない)。 */
export const VOICE_ENGINE_HOST = '127.0.0.1';
/** サイドカーの待受ポート(VOICEVOX/AivisSpeech 既定)。 */
export const VOICE_ENGINE_PORT = 10101;
/** TTS クライアントが叩く baseUrl(voice.json の baseUrl と一致させる)。 */
export const VOICE_ENGINE_BASE_URL = `http://${VOICE_ENGINE_HOST}:${VOICE_ENGINE_PORT}`;
/** spawn 後 /version が応答するまでの待ち上限(ms)。BERT/モデルがキャッシュ済みなら数秒で立つ。 */
export const VOICE_ENGINE_HEALTH_TIMEOUT_MS = 30000;
/** ヘルスポーリングの間隔(ms)。 */
export const VOICE_ENGINE_HEALTH_INTERVAL_MS = 600;
/** kill 要求後、プロセスツリーを強制終了(taskkill)に切り替えるまでの猶予(ms)。 */
export const VOICE_ENGINE_STOP_GRACE_MS = 2000;

// --- ウィンドウ(設計書 §8.1) ---
// task_13: 全身立ち絵(比≈0.65)を中央帯に置き、上=吹き出し余白/下=入力欄余白を確保する縦長窓。
// キャラ表示帯 ≈ 368px(幅 260 で contain → 約 239×368)＋上余白100＋下余白52 = 520。
/** キャラ部分のウィンドウ幅。 */
export const WINDOW_WIDTH = 260;
/** キャラ部分のウィンドウ高さ。 */
export const WINDOW_HEIGHT = 520;
/** 画面端からの既定マージン(初回配置・右下)。 */
export const WINDOW_EDGE_MARGIN = 20;

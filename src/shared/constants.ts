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

/**
 * 第一声短縮(施策A):最初の発話チャンクだけ、文末を待たず読点(、)/改行/この字数で区切る上限。
 * 「ひと呼吸」程度の長さ。2文目以降は通常の文単位(splitSentences)に戻る。
 */
export const FIRST_CHUNK_MAX_CHARS = 20;

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

/**
 * STT モデル(whisper-small・ONNX)のディレクトリ名。data/models/ 配下に別DLで配置。
 * 2026-06-09 計測で turbo→small へ既定変更:エンコーダ12層で stt ~3000ms→~800ms(約1/4)、
 * 日本語精度は turbo と実質同等(通常文は完全一致・固有名詞の誤認は全モデル共通)。N-LAT-6。
 * より高精度が要るときは ENE_STT_MODEL_DIR=whisper-large-v3-turbo で差し替え可(下記 env)。
 */
export const STT_MODEL_DIR = 'whisper-small';

/**
 * STT モデルディレクトリの env 上書き(A/B 比較・高精度フォールバック用)。値=data/models/ 配下のディレクトリ名。
 * 例 `ENE_STT_MODEL_DIR=whisper-large-v3-turbo` で高精度モデルへ差し替える。
 * 既定(未指定)は STT_MODEL_DIR(=whisper-small)。
 */
export const STT_MODEL_DIR_ENV = 'ENE_STT_MODEL_DIR';

/** Whisper が前提とするサンプリングレート(16kHz 固定)。マイク取得もこのレートで行う。 */
export const STT_SAMPLE_RATE = 16000;

/** 認識言語(日本語固定)。短い発話での言語自動判定のブレを防ぐ。 */
export const STT_LANGUAGE = 'japanese';

// --- ローカル判別器(B-15・Haiku Router をネットワーク0往復のローカル判定へ置換) ---

/** キーワード一致に使う topics の最小文字数。1文字 topic(車/薬 等)の部分文字列誤一致(電車/薬局)を避け、埋め込みに委ねる。 */
export const ROUTER_KEYWORD_MIN_LEN = 2;
/** 埋め込み判別を試す発話の最小文字数。これ未満(短い挨拶)は topic 無し=medium(雑談)に倒す。 */
export const ROUTER_EMBED_MIN_CHARS = 4;
/** 埋め込み類似(コサイン)で domain を採用する閾値。未満は medium に倒す(保守・「迷ったら medium」)。実機で要調整。 */
export const LOCAL_ROUTER_SIM_THRESHOLD = 0.55;

// --- 二段生成(B-15b・雑談=Haiku/難題=Sonnet) ---

/**
 * 二段生成を有効化する環境変数名(値 "1" で ON)。**既定オフ**=従来どおり全て Sonnet 生成。
 * キャラ一貫性(成功基準8)の試聴判定が要るため、検証用に env で切替える(承認後に既定 ON 判断)。
 */
export const TWO_TIER_ENABLED_ENV = 'ENE_TWO_TIER';
/** これより長い発話は「複雑」とみなし Sonnet 生成へ(短い雑談のみ Haiku に回す)。 */
export const GENERATION_LONG_UTTERANCE_CHARS = 40;

// --- 思考フィラー(task_18 Phase C・B-15連動・「うーん…」) ---

/**
 * 思考フィラーを出す発話の最小文字数。これ以上の medium/low の問い、または相談・意見系で「うーん…」を挟む。
 * 設計憲法:**問いの性質で決め、遅延では決めない**(得意分野=即答/ごく短い雑談=軽い、では出さない)。
 */
export const FILLER_MIN_CHARS = 16;

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
 * 体感改善のため 700→500→350 と短縮したが、**文中の間(言いよどみ・息継ぎ)を終話と誤確定し、
 * 途中応答が溜まって最後に連発する**問題が実機で顕在化(2026-06-10 ユーザー報告)。いったん 800 へ戻す。
 * 固定しきい値は「人により間の長さが違う」問題を本質的に解けないため、別途 transcript 末尾の
 * 意味的エンドポイント判定(日本語の接続助詞=継続シグナル)＋応答コアレッシングで補う方針(検討中)。
 * 下限は BACKCHANNEL_PAUSE_TRIGGER_MS より大きく保つこと(ターン終了と相槌の言いよどみを区別するため)。
 */
export const VAD_MIN_SILENCE_MS = 800;
/**
 * コアレッシング(投機生成＋連結)を有効化する env(値 "1" で ON)。既定オフ=現状の経路(無音800ms・renderer 駆動)。
 * ON 時はハンズフリーの話終わりを**暫定**扱いにし、短い無音で投機生成を開始、発話再開で静かにキャンセル＋連結する。
 */
export const COALESCE_ENABLED_ENV = 'ENE_COALESCE';
/**
 * コアレッシング時の**暫定**ターン終了とみなす無音(ms)。短くして投機生成を早く始める
 * (どのみち Claude の応答に時間がかかる=その死に時間が「発話再開を待つ窓」になる)。
 * 第一声(コミット)が出る前にユーザが再開すれば静かにキャンセルして連結し直す。
 */
export const VAD_PROVISIONAL_SILENCE_MS = 500;

// --- コアレッシングの適応(段階②/案①・無音窓を自動伸縮・メモリのみ) ---
// 目的「聞こえる中断(barge-in)を避けられる範囲で、できるだけ窓を短く」(ユーザー設計・案①)。
//  - サイレントキャンセル(第一声=コミット**前**の再開)→ 声が出る前に捕捉=余裕あり → **窓を短く**。
//  - 早い barge-in(無音開始〜MAX窓以内の被せ)= まだ喋ってた/トリミが速すぎた=窓を延ばせば防げた → **窓を長く**。
//  - 遅い barge-in(MAX窓超)= 本物の割り込み=窓では直せない → **中立**。
// barge-in の早い/遅いは「無音開始からの経過 ≤ MAX窓」で判定(=窓を最大にしていたら防げたか)。
/** 無音窓の下限(ms・これ未満は流暢な人でも食い気味になる)。 */
export const COALESCE_WINDOW_MIN_MS = 400;
/** 無音窓の上限(ms・これ超は無反応に感じる)。早い/遅い barge-in の判定境界も兼ねる。 */
export const COALESCE_WINDOW_MAX_MS = 1200;
/** サイレントキャンセル時に窓を縮める量(ms・小さく=じわじわ短く)。 */
export const COALESCE_WINDOW_STEP_DOWN_MS = 30;
/** 早い barge-in 時に窓を伸ばす量(ms・大きく=被せ=可聴の失敗は早く back off)。 */
export const COALESCE_WINDOW_STEP_UP_MS = 200;
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
 * 言いよどみ(発話中の短い無音)が相槌の「資格あり(arm)」になる継続(ms)。
 * 必ず VAD_MIN_SILENCE_MS(=ターン終了)より小さくする。**B-17(fire-on-resume)では arm 窓
 * [pauseTrigger, turnEnd) で武装し、発話が再開した時に打つ**ため、窓が狭いと実際に発火しない。
 * turnEnd=350 に対し 300 だと窓 50ms(≈1フレーム)で狭すぎたため 200 へ(窓 150ms・自然な言いよどみを拾う)。
 */
export const BACKCHANNEL_PAUSE_TRIGGER_MS = 200;
/** 相槌/フィラーの発話速度倍率(neutral 比)。1未満=ゆっくり=落ち着き。0.92→0.85(ユーザー試聴・2026-06-10)。 */
export const BACKCHANNEL_SPEED_SCALE = 0.85;
/** 相槌/フィラーの音量倍率(neutral 比)。控えめにして「うるさい」を抑える(ユーザー要望・2026-06-10)。 */
export const BACKCHANNEL_VOLUME_SCALE = 0.6;
/**
 * 相槌で**実際に声を出す**確率(0..1)。残りは「うなずき(無音)」のみ=毎回声が出てうっとおしいのを防ぐ
 * (ユーザー要望: からだのうなずきと音声をだいたい交互に)。フィラーは別(常に声を出す)。
 */
export const BACKCHANNEL_VOICE_RATIO = 0.5;
// 韻律トーン判定 Lv2 の閾値(BACKCHANNEL_EMPHASIS_RATIO / BACKCHANNEL_PITCH_RATIO)は
// 2026-06-10 に撤去した(語彙を continuer に統一して死蔵化したため)。
// 設計は docs/archive/design-revision-backchannel-prosody-lv2.md。

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

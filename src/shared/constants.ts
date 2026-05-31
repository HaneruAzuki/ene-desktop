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

# ENE Desktop Changelog

すべての注目すべき変更をこのファイルに記録する。
形式は [Keep a Changelog](https://keepachangelog.com/ja/) に概ね従う。

## [0.1.0] - 2026-06-03

### Added

- 初回 MVP リリース。
- キャラクター **ENE**(ツンデレ・IT好きの少女)。人格・知識・口調は `/characters/ene/*.json` で管理。
- 透過ウィンドウの常駐表示(フレームレス・最前面・ドラッグ移動・クリックスルー)とタスクトレイ。
- Claude Sonnet による会話(キャラ口調・AI自称防止の4層防御)。
- Knowledge Router によるトピック判定(Claude Haiku・ベストエフォート/フォールバック)。
- 3層記憶システム(短期・中期 Episodic・長期 Semantic、タグ/カテゴリ/重要度/年での検索)。
- 会話からの記憶抽出(短期記憶 overflow 時・終了時)。
- OS 操作(メモ帳 / ブラウザ / フォルダ)をホワイトリスト方式で安全に実行。
- API キー管理ダイアログ(形式検証・疎通テスト・safeStorage による暗号化保存)。
- 起動シーケンス(書込検証・クラウド同期警告・APIキー・誕生日判定・挨拶)と終了時の記憶抽出。
- インストール不要の Windows ポータブル exe(`data/` は exe の隣に生成)。

### 既知の制限 / MVP 後のブラッシュアップ予定

- Knowledge Router のタイムアウト(800ms)が実 Haiku レイテンシを下回り、毎回 fallback になりやすい。
- 短期記憶 20 件超過後はメッセージごとに記憶抽出が走り、追加 API 呼び出しが発生する。
- portrait / アイコンはプレースホルダー画像(正式画像は別途差し替え予定)。

詳細な設計判断・既知の不備は `docs/implementation-notes.md` を参照。

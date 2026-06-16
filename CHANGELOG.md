# ENE Desktop Changelog

すべての注目すべき変更をこのファイルに記録する。
形式は [Keep a Changelog](https://keepachangelog.com/ja/) に概ね従う。

## [Unreleased]

> 0.1.0(MVP)以降、`post-mvp-latency-voice-forgetting` ブランチで進行中の変更。
> 判断ログは `docs/implementation-notes.md`(N-xx)、残件は `docs/optimization-backlog.md` を参照。
> 下の 0.1.0 は MVP 当時の記録(歴史)であり、本節が現状を上書きする。

### Changed

- **キャラクター方針の転換**:入れ替え前提の汎用キャラから、一人の固定キャラ **魚川トリミ**(うおかわ とりみ)へ。ENE はコードネーム、`characterId` は `"ene"` のまま。人格・知識・口調・人生記憶はすべて `ene/*.json` に外出しする(コードにハードコードしない)。
- **Knowledge Router をローカル化**:トピック判定の Claude Haiku 呼び出しを、完全ローカルの語彙判別器(`knowledge/local-classifier.ts`)へ置換。ネットワーク往復ゼロ。
- **レイテンシ最適化**:体感応答を約半減(STT を whisper-small へ・第一声の文単位ストリーミング・二段生成・記憶抽出を応答クリティカルパスの外へ)。
- **Electron 30 → 42** へアップグレード。

### Added

- **声と耳(音声会話)**:ローカル TTS(AivisSpeech サイドカー・魚川トリミ専用音声モデル)、ローカル STT(whisper-small・transformers.js)、双方向ハンズフリー会話(Silero VAD v4・barge-in)、相槌・思考フィラー、長い語りを腰を据えて聞く傾聴モード。すべてローカル / BYO-Claude を維持。
- **VRM 3D 表示**:three-vrm による立体表示(まばたき・口パク・うなずき・あくび・傾聴の首かしげ・離席・覗き)。2D 立ち絵はフォールバックとして維持。
- **UI 改修**:ホバーでキャラ胸元に操作バー(マイク/音量/離席/設定/じゃあね)、統合設定パネル、API キー画面の刷新。
- **存在感の改修**:オフスクリーンライフ(会っていない間の暮らしを生成し記憶化)、「気にかけ」(open loop)、自発発話、知識ギャップ(名前などを尋ねて埋める)。
- **忘却機構**:段階的な記憶縮退(consolidation / forgetting・要約失敗時は削除しない安全側)。
- **主人名の固定**:呼び方(userName)の設定 UI とロック、本名のパッシブ記憶。

### Removed

- **タスクトレイ**:常時タスクバー表示＋ホバー操作バーへ統合したため廃止。

### Fixed

- 音声 / 埋め込みモデルの初期化失敗が再起動まで治らなかった不具合(失敗時に自己回復するよう修正)。
- 非ストリーミング発話でルビ(漢字《よみ》)が読み下されず、TTS が記号や読み仮名を読み上げていた不具合。
- 記憶想起の provenance 混線(canon と user 記憶の取り違え・N-RECALL-1)。

### 構造・規約

- IPC チャネル名を単一の真実の源(`shared/ipc-channels.ts`)へ集約し、main / preload の綴りズレをコンパイル時に検出。
- 依存方向を dependency-cruiser で機械強制(ドメイン→app 逆流・shared→上位・循環・memory 索引実装の層外参照を禁止)。

## [0.1.0] - 2026-06-03

### Added

- 初回 MVP リリース。
- キャラクター **ENE**(ツンデレ・IT好きの少女)。人格・知識・口調は `/ene/*.json` で管理。
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

# 最適化・ブラッシュアップ バックログ

> **この文書の位置づけ**
> 0.1〜0.3 の動作自体は妨げないが、**最適化フェーズで改善する項目**のリスト。
> 各項目は実装時に判明した課題(`docs/implementation-notes.md` の N-xx)由来。
> 着手時は CLAUDE §14 に従いユーザ承認を得てから。完了したら本リストから消し、
> 必要なら implementation-notes に結果を残す。
>
> 課題の詳細な経緯は `implementation-notes.md`、設計の正解は `03_design.md` を参照。

---

## 設計の憲法(レイテンシと"間"の三原則・2026-06-08 確定)

レイテンシ最適化と「間/相槌」機能は、**別々の根拠で独立に設計し、互いを言い訳に使わない**。

1. **キャラの性格を言い訳に「遅い」を正当化しない。** 計算は常に最小化する。
2. **遅延の利用は「速すぎる応答を一定の"間"まで意図的に遅らせる」だけ。** 遅いのを引き伸ばさない。
3. **相槌・思考フィラーは正当な機能。** その時間は**棚からぼたもち**(技術的限界に時間を与える副次効果)
   であって、**設計目標にしない**。尺・有無を遅延に合わせてチューニングした瞬間に「遅延隠し」に堕ちる。

**判別テスト** ―「もしアプリが一瞬で応答できたら、それでもこれをやるか?」YES なら正当 / NO なら遅延隠し=禁止。
相槌エンジンの設計は `tasks/task_18_backchannel.md`。

### レイテンシ構造と戦略(会話1ターン)

`handleSendMessage`([src/app/main/ipc.ts](../src/app/main/ipc.ts))はほぼ直列。**会話で伸びる要因**=🔴記憶抽出の同期実行(B-01 ✅2026-06-09 背景化で解消)
/ 🟠episodic二重ロード(B-14a ✅解消)/ 🟠毎ターン埋め込み推論(B-14c 残)。**固定費**=🔵Sonnet往復(非ストリーミング・B-06)。
Router は**ローカル判別器へ置換済**(B-15 ✅・ネットワーク0往復。記憶構築の直後に query 埋め込みを共有して判定)。
脳=Claude は唯一の不可避な外部往復(BYO-Claude=軽量の柱と整合)。**声/STT/想起は完全ローカルを維持**(外部Web非依存=絶対条件)。
→ 戦略:**総時間でなく「最初の一声までの時間」を縮める**(ストリーミング B-06)＋**周辺ローカル処理を限りなく0に**(B-14)＋**容量を恒久ガバナ**(B-13)。

---

## 優先度:高(体感・コストに直結)

> ✅ **B-01 / B-02 は 2026-06-09 解消済**(記憶抽出をバックグラウンド化＋直列化ロック＋8件バッチ化し、
> 応答クリティカルパスから除去)。詳細は `implementation-notes.md` N-LAT-1。本リストから削除した。

### B-03 Router タイムアウトが実 Haiku レイテンシを下回り毎回 fallback ✅解決済(2026-06-09)
- **由来**: N-09-9。
- **内容**: `ROUTER_TIMEOUT_MS=800` が実 Haiku 往復(約1.5〜2.5s)を下回り、Router が実質常に fallback=medium。トピック別 few-shot が効かない。
- **緩和済**: 知識境界は system プロンプトに含むため「知らない」応答は成立(成功基準4は担保)。
- **✅ (b) 2026-06-09 実施**: Router を記憶構築と `Promise.all` で並列実行し、~800ms を critical path から隠した(N-LAT-2)。
- **✅ (d) 2026-06-09 解決(本体)**: **B-15 でローカル判別器(`local-classifier.ts`)に置換**=ネットワーク往復ごと削除。`ROUTER_TIMEOUT_MS=0` で失われていた**話題別 behavior/few-shot(tech=得意げ/賭博=困惑/危険=拒否)が復活**。実機検証済(N-LAT-9)。fallback=medium 常態化の本体は解消。
- **採らなかった案**: (a) タイムアウト ~2000ms 化(総応答が NF-PERF-02 の 3〜5s を超えうる)(c) best-effort 据え置き。いずれも (d) で不要に。

### B-13 中期記憶に容量ガバナがない(O(n)で会話が伸びると重くなる)★構造的本丸 ※実装済＋実機検証済(既定オフ)
- **✅ 2026-06-09 実装＋実機検証済**: 忘却機構を `task_19` として実装(月次/年次サマリ＋重要度しきい値の物理削除・短期ハード上限(a)同梱)。**ただし破壊的処理のため既定オフ**(`ENE_FORGETTING=1` で有効化)。**実機検証済(2026-06-09)**=実データをバックアップ→`ENE_FORGETTING=1` で実走→検査→復元し、完了月5件の各1サマリ化・低 importance(≤2)の物理削除・ベクトル索引 prune・逆引き再構築・背景実行で起動非ブロック・年次は2024以前なしで正しくスキップ、を確認。詳細 `implementation-notes.md` N-FORGET-1 / `tasks/task_19_forgetting.md`。残=5年サマリ・「忘れて」指示削除。
- **由来**: 2026-06-08 設計セッション / 設計書 §11.6(忘却機構・既に詳細設計あり)。
- **症状**: 容量上限は**短期記憶=20件のみ**。中期(episodic)は**上限なし**で青天井に増え、毎ターン**全件ロード**するため想起が O(n) で重くなる(B-01 の抽出ブロックとは別の、もう一つの「会話で伸びる」要因)。
- **修正案**: 設計書 §11.6 の**忘却機構を実装**=月次/年次再要約＋**重要度≤2を削除**で常時 1000 件以下に収める。容量を恒久的にガバナする。
- **二重の理由**: §11.6 は「検索インデックスより先に実装せよ」と明記。task_15(ベクトル)を先にやり順序が逆になっている。**ビジョン柱1「人間らしい忘却」の本質機能＋レイテンシ恒久解**の両方を兼ねる。閉じた記憶層変更。
- **同梱(2026-06-09 ユーザ決定)**: B-01 で短期記憶のハード上限が外れた(未抽出は捨てない方針)。本タスクで **短期にハード天井 N を復活＝採用(a)「超過時に同期抽出を1回強制」**(上限を守りつつ記憶も失わない)。N の値は実装時に決定(目安 ~100)。

### B-14 想起パスのローカル高速化(ワーカー・ウォーム)※ (a)(d) 完了
- **由来**: 2026-06-08 設計セッション(コード読み)。
- **✅ (a) 2026-06-09 解消**: `buildHeartDeps` と `retrieve`(loadRecallPool)の **episodic 二重ロード**を、新 `buildConversationMemory` で1回ロード→心の導出と想起で使い回す形に統合(N-LAT-2)。
- **✅ (d) 2026-06-09 解消**: Router と想起を `Promise.all` で並列実行(B-03(b) と同一実装)。
- **✅ (c) 2026-06-09 実装**: 埋め込みモデルを**起動時ウォーム**(`warmEmbedder`・lifecycle Step8.4・背景best-effort)＝初回想起のモデルロード停止を消す。＋**クエリ埋め込みキャッシュ**(`embedder` 内 LRU風・同一クエリの再埋め込み省略)。N-LAT-5。
- **残 (b)**: 想起・埋め込みを**ワーカースレッド**へ(main のイベントループを止めない)。**ただし効果は要計測**(onnxruntime は既に重い計算を裏スレッドで実行・B-03b で Router 裏に隠れ済)＋統合リスク(worker から electron `app` 不可=パス注入要・パッケージ版の native/asar)。**計測で実害が出た場合のみ着手**。
- 品質劣化ゼロのローカル施策。

---

## 優先度:中(表現・品質)

### B-04 抽出が episodic を作りにくい(中期記憶が残りにくい体感)
- **由来**: N-12-4。
- **内容**: 抽出 LLM が嗜好を semantic へ寄せ、雑談を「長期的に意味ある出来事ではない」と判断し episodic=null にしがち(実機5質問で episodic 0件)。動作は正常だが「中期記憶が残らない」体感。
- **改善案**: 抽出プロンプトの基準緩和 or episodic/semantic 振り分けの再検討(1抽出=最大1 episodic の制約含む)。

### B-05 リップシンクが時間ベース近似(振幅ドリブン未実装)✅解決済(2026-06-12・VRM側)
- **由来**: F-ANIM-05 / N-17-11。
- **内容**: talking の口パクはメッセージ長比例の時間ベース。0.3 で音声振幅ドリブンへ差し替える予定が未実施。
- **✅ 解決(2026-06-12・F/N-VRM-1)**: VRM 表示の口パクを**振幅ドリブン**化。`audio-player.ts` の Web Audio グラフに `AnalyserNode` を挟み `getVoiceAmplitude()`(RMS)で口形 `aa` を駆動(話し終わりは amp=0 で自然に閉じる)。※ PNG 立ち絵フォールバック経路は時間ベースのまま(VRM が主経路)。

### B-17 相槌が文末ポーズでも発火する(本来は文中の言いよどみだけ)
- **由来**: 2026-06-09 実機(ユーザー観察)。第一声レイテンシ調査中に発覚。
- **内容**: `BackchannelEngine.push` は無音が `pauseTriggerMs`(現300ms)に達した**瞬間に発火**する。話し終わりの最終ポーズも 300ms を通過してから終話(`VAD_MIN_SILENCE_MS`=350ms)になるため、**文末でも「うん」が出てしまう**。文末は応答を返す場面=相槌は本来不要。
- **レイテンシ影響なし(確認済)**: 終話判定は相槌と同一フレームで独立評価。相槌音声は別チャンネル `ene:backchannel`→別プレイヤー `playBackchannel`(応答 `ene:voice-chunk`→`enqueueAudio` とは別キュー)。よって**応答は遅延しない**=純粋に「不要な音」の問題。
- **改善案(本命)**: **発火を「ポーズ到達時」→「発話再開時」に変更**。無音が `pauseTriggerMs` に達したら "armed" とマークだけし、**その後に発話が再開した時にだけ撃つ**。最終ポーズは再開しない(終話→reset)ので**文末では撃たない**。文中の言いよどみ(止まって→続けた)だけで撃つ=本来の相槌の意味と一致。トレードオフ:タイミングが再開の瞬間へ僅かに後ろ・再開発話とのエコー重なりに注意(echoCancellation で緩和)。
- **代替案**: `pauseTrigger` と `VAD_MIN_SILENCE_MS` のギャップを広げる(根治せず=最終ポーズは必ず trigger を通過するので不可)。
- **メモ**: 2026-06-09 にユーザー判断で**見送り**(遅延原因でないため)。相槌チューニングのブラッシュアップ時に対応。設計は `tasks/task_18_backchannel.md`。

### B-06 C1 ストリーミング音声がライブ未配線(レイテンシ最適化)★体感の本丸 ※読み形式は確定・実装済
- **由来**: N-17-11 / 03_design §11.1 / 2026-06-08 設計セッション / 2026-06-09 読み方式決定。
- **内容**: `stream-parser.ts`/`sentence-splitter.ts`/`voice-chat.runVoiceChat` は純粋ロジック＋単体テストとして存在するが、実会話は非ストリーミング(完成JSON→文単位合成)。ストリーミング配線で**第一声 3-5s→〜1.5s**の改善余地。
- **読み方式の決定(2026-06-09・調査 wk3n8tig6 後)**: 文脈依存の同形異音語は静的辞書では解けない(AivisSpeech は pyopenjtalk 静的辞書・BERTは韻律のみ・調査で裏取り)。Path B(1エンジン完結)は該当なし、Fish Speech はNCで失格。→ **Claude振り仮名方式を採用**:Claude が `message` に**青空文庫式ルビ「漢字《よみ》」**を曖昧語だけ付け、パーサが表示用(stripRuby)と音声用(rubyToReading)へ分解。**Claude固有API非依存=自前ルビ書式なので他社/ローカルLLMでも動く**(ユーザ制約「Claude専用にしない」)。`reading` フィールドは廃止。
- **✅ 読み形式 実装済(2026-06-09)**: `ruby.ts`(strip/解決)＋ response-parser ＋ prompt-builder ＋ 型(N-LAT-3)。
- **✅ ストリーミング本体 実装済＋実機検証済(2026-06-09・既定オフ)**: JSON契約を維持したまま `message` 値を逐次抽出する `json-stream-parser.ts`(VoiceStreamParser 実装)＋ `client.makeStreamCall`(SDK stream)＋ `runVoiceChat` 再利用(ルビ解決＋C2 文単位自称ゲート)＋ `voice-runtime.streamVoiceChat`＋ ipc 配線。**`ENE_VOICE_STREAMING=1` で有効化(既定オフ)・失敗時は非ストリーミングへフォールバック**。全413テスト緑(N-LAT-4)。**実機検証済(2026-06-09・`ENE_VOICE_STREAMING=1`)**=実 Claude streaming＋TTS＋renderer で第一声短縮・文割れ・C2 を確認。第一声の内訳計測で TTFT 律速と判明(N-LAT-7)。
- **✅ 既定ON化(2026-06-13・6188051)**: ユーザ試聴判定で既定 ON へ昇格(`ENE_VOICE_STREAMING=0` で無効化可・失敗時は非ストリーミングへフォールバック)。残=emotion が message より後に来た場合の早期確定漏れ(プロンプトで前置指示済・best-effort)のみ。
- **任意の上乗せ(将来・プロバイダ非依存の保険)**: ローカル読み基盤=ユーザ辞書(固有名詞)＋ **Yomikata**(BERT・130語・**要ライセンス確認**)＋ marine-plus(Apache-2.0)。LLMが弱い時のフォールバック。調査 wk3n8tig6 の Path D。

### B-15 判別器のローカル化 ✅実装済(2026-06-09)／二段Claude(雑談=Haiku/難題=Sonnet)は残
- **由来**: 2026-06-08 設計セッション(ユーザ「第２の脳」案の現実形)。
- **方針**: **生成は当面 Claude のまま**(一貫性=成功基準8・軽量100MB柱を死守)。**判別だけローカル化**する。
- **✅ (a) 判別器のローカル化 完了(2026-06-09・N-LAT-9)**: Haiku Router(ネットワーク往復)を**完全ローカルのハイブリッド判別**(`src/knowledge/local-classifier.ts` `classifyTopicLocal`)へ置換し**ネットワーク0往復**。①topics 部分文字列キーワード一致 → ②埋め込み類似(想起と共用のウォーム済 ruri・コサイン閾値 `LOCAL_ROUTER_SIM_THRESHOLD=0.55`)→ ③迷ったら medium fallback。複数一致は refuse>none>high>low>medium 優先。1文字 topic(車/薬)はキーワード除外し埋め込みに委ねる。ipc は memory→classifyTopicLocal の順(query 埋め込みをキャッシュ共有・embed 競合回避)。起動時に `warmLocalRouter` で topics をウォーム。Haiku 版 `classifyTopic` は legacy として温存(→ その後 2026-06-12 に死蔵コードとして削除・git 履歴から復元可)。**B-03 解消**(話題別 few-shot 復活)。実機検証済(keyword domain=high/none、embed domain=high sim=0.81 等)。
- **✅ (b) 二段Claude 完了(実装 2f92608・既定ON化 2026-06-13・6188051)**: 雑談=Haiku/難題=Sonnet を `chooseModelTier` で振り分け(迷ったら Sonnet)。ユーザ試聴でキャラ一貫性OKを確認し**既定 ON**(`ENE_TWO_TIER=0` で全 Sonnet に戻せる)。
- **連動**: この「熟考に値する問いか」の判定は **task_18 の思考フィラー「うーん」の発火条件**と共有できる。
- **保留(条件付き)**: ローカルLLMで**生成**まで担うのは一貫性・軽量性と衝突し、CPUでは TTFT で勝てない可能性が高い。**GPU＋サイズ容認を決めた場合のみ将来研究**(§11.7 LLM抽象化が受け皿)。

---

## 優先度:低(ビルド・運用)

### B-16 レイテンシのノブ(随時・任意)
- **由来**: 2026-06-08 設計セッション。
- **内容**: (a) **応答を短く**(生成時間∝出力トークン・会話相手は短く返すのが自然)。(b) **STT の GPU 化**(下記 B-16b)。(c) **クエリ用に軽い埋め込み(ruri-30m)** or **雑談はベクトル想起スキップ**。効果は小〜中のチューニングノブ。

### B-16b STT の GPU(iGPU)アクセラレーション(2026-06-12 調査・記録)
- **背景**: kotoba-whisper-v2.2(日本語最高精度)導入で STT が q8・CPU で **~1.8秒**(大きい large-v3 エンコーダが律速)。精度は良いが体感死に時間が small 比 +約1秒。**iGPU でエンコーダを加速できれば ~0.5〜1秒に短縮見込み**。
- **iGPU は使えるか(ユーザー問い・2026-06-12)**: **使える。2023年以降のiGPUなら無駄でない。** Radeon 780M(~8 TFLOPS FP16)/Intel Arc iGPU(Core Ultra・~4-5)/Iris Xe(~2)で whisper-large系エンコーダは **CPU比 2〜4倍**現実的。低価格の Intel UHD のみ非力で恩恵小。NPU(Core Ultra/Ryzen AI)は適役だが onnxruntime 対応(OpenVINO/QNN)が断片的・非可搬で除外。
- **2経路**(トレードオフ):
  - **WebGPU(renderer 移設)**: transformers.js `device:'webgpu'`。Chromium 経由で **Intel/AMD/NVIDIA 問わず動く=最も可搬**。要 STT を main→renderer へ移設(マイク取得は renderer なので相性は悪くない)。**推奨経路**。
  - **DirectML(main)**: onnxruntime-node の DirectML EP。任意の DX12 GPU(iGPU含む)。**Windows専用＋CPU一本化方針(N-17-4)の逆行＋約38MB**。可搬性を捨ててよい場合のみ。
- **現状**: STT は main・onnxruntime-node・**CPU**(`stt-transcriber.ts`・dtype 自動判定)。kotoba q8 ~1.8s は当面許容。起動時ウォーム(`warmStt`)で初回発話の読込待ちは前倒し済(2026-06-12)。
- **着手条件**: STT がレイテンシのボトルネックと判断したら。**WebGPU(最も可搬)を第一候補**に。CPU フォールバックは必須(弱い iGPU/ドライバ問題への保険)。

### B-07 パッケージ時のログ保存先が %APPDATA%(data/logs ではない)
- **由来**: N-11-4。
- **内容**: パッケージ版で `main.log` が `data/logs` ではなく `%APPDATA%/ene-desktop/logs` に出力(記憶・設定の永続化は正常)。electron-log 設定を見直す。

### B-08 winCodeSign 展開の手動回避が必要
- **由来**: N-11-1。
- **内容**: ビルドに winCodeSign の手動キャッシュ配置が必要(シンボリックリンク権限)。Windows 開発者モード有効化 or CI 整備で恒久化。

### B-09 ベクトル想起の実機ランタイム確認(1回)
- **由来**: N-15-9 / N-17-4。
- **内容**: `package:portable` 済(72MB・onnx binding 同梱・DirectML 除外を確認)だが、実機での「ベクトル想起発火 → native load 成功」確認が1回未了。

---

## 創作・アセット(コードではない)

### B-10 キャラ資産の改名(ENE → 魚川トリミ)✅完了(2026-06-09)
- **由来**: N-16-1 / 命名の正本 `01_vision.md` §3 柱2。
- **✅ 完了(2026-06-09・N-16-2)**: 表示名 = **魚川トリミ**(読み:**うおかわ とりみ**)。`identity.json`(`name`/`nameReading`/`callsSelf=トリミ`/`sttAliases`)・`fewshot.json`・挨拶台詞の "ENE" 自称を新名へ。**STT 名前補正**(発話全体が名前エイリアスのときだけ callsSelf へ置換=「取り身」等の誤認を補正・`correctNameMishear`)。`productName=魚川トリミ`＋main 冒頭で `app.setName('ene-desktop')` で userData/API キー保存先を ASCII 固定(exe 名は `Torimi-${version}.exe`)。`characterId` は `"ene"` のまま(コードネーム ENE はプロジェクト名/識別子として残す)。詳細 `implementation-notes.md` N-16-2。
- **残(別判断)**: STT プロンプトバイアス(transformers.js アップグレード要承認)のみ別タスク側。canon(`life-memory.json`)執筆・ガードレール反映は完了(N-16-7 / N-16-12・B-12)。

### B-11 未制作スプライト(thinking / sofa / surprise)
- **由来**: N-13-4 / N-13-8。
- **内容**: 2D立ち絵を追加し `animation.json` の `map`/`frames` を足すだけで有効化(コード変更不要)。emotion few-shot・JSON 精緻化も随時。
- ※ 立ち絵の表示サイズ不整合(`object-fit: contain`・縦長窓)は task_13 で**解決済み**。

### B-12 ガードレールの fewshot/プロンプト反映 ✅完了(2026-06-10)
- **由来**: N-16-7。
- **内容**: canon ガードレール A(ハッキング実行 `refuse`)/B(性的会話 `refuse` 線)/C(初恋の身体面はぐらかし)を `fewshot.json`・`knowledge_domains.json` へ反映。
- **✅ 完了(2026-06-10・N-16-12)**: A=`examples.refuse` にハッキング実行拒否例(才能は残し実行は断る・canon「仕組みを覗く才能」整合)。C=新キー `examples.love_boundary` に「事実は認める/身体面は恒久はぐらかし」例(canon「過去に交際していた事実」整合)。B=既存(canon「知ったかぶりの大恥」＋`knowledge_domains.refuse`「成人向けコンテンツ」)で充足のため新規不要と判断。`prompt-builder.buildFixedFewshot` が全キーを毎ターン投入するため新キーも自動的にプロンプトへ載る。character-loader/prompt-builder テスト緑。

### B-18 忘却 × 暮らしの断片(daily-life)の縮退(N-PRES-3)
- **由来**: 存在感の改修 P3。`generateOffscreenLife` が `provenance:'self'`・`category:'daily-life'` の暮らしの断片を保存する。
- **現状(v1)**: forgetting は `provenance:'self'` を全除外=暮らしの断片も対象外(canon と同じく保持)。
  forgetting は既定オフ・レビュー後有効化のため、v1 では accumulation も発火しない。
- **やること**: forgetting を実運用で有効化する際に、daily-life を **provenance を保ったまま**縮退させる
  (低 importance を月次で削除/または provenance:'self' のサマリへ巻き上げ)。**user サマリへ混ぜない**こと
  (混ぜると「あなた自身の思い出」が「相手について」に化ける provenance 汚染)。consolidation-policy の provenance 分離が要る。

---

*完了した項目は本リストから削除し、結果を `implementation-notes.md` に残すこと。*

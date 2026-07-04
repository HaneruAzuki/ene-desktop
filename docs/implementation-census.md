# 実装センサス(Implementation Census)— v1(敵対的レビュー反映)

> **スナップショット**:branch `post-mvp-latency-voice-forgetting` / HEAD `780d07a` / 2026-06-24
> **出典**:`src/`・設定JSON(`ene/*.json`・`voice.json`)・`electron-builder.yml`・`installer.nsh`・`package.json`・`scripts/` の**実装読解のみ**。`docs/` は事実の出典に含めない(docs の主張と実装が食い違う点は「矛盾候補」に別記)。
> **凡例**:`[静的確認済]`=コードで確実 / `[要実機確認]`=実行時挙動で静的には断定不可 / `[疑わしい]`=バグ・死にコード・既定オフの疑い。**capability**=コードが出来ること / **shipped-default**=出荷既定の設定で実際に起きること。
> **重要な性質**:これは**点-in-time スナップショット**であり、コミットごとに陳腐化する。durable SSOT ではない。特に **memory ドメインは並走作業が直近で改修・コミット済み**(`5d34f94` valence 撤去 / `9dec614` 心簡素化 / `29e8ebf` open-loops 再設計)のため、このHEADで**再センサス**してある。
> **既反映の修正**:`48c3958`(init-directories の config/logs 是正)・`780d07a`(web-contents-created ナビ/新窓ガード)は本台帳に反映済み。
> **次工程**:本 v0 に対し**台帳⇄実装の敵対的レビュー(refuter パス)**を実施し v1 を作る。

---

## 0. エグゼクティブサマリ

### 0.1 外部通信の実態(売り文句の根幹)
意図された外部 egress は**2系統のみ**:
1. **`api.anthropic.com`**(会話テキスト・記憶抽出・要約・ウォーム・ping)。baseURL をコード固定し `ANTHROPIC_BASE_URL` 上書きを封鎖。`client.ts:33`
2. **electron-updater → GitHub Releases**(**packaged 版は起動毎に更新チェック GET**、同意後のみ本体DL、dev では無効、`logger=null`・送信データ無し設計)。`auto-update.ts:30-36`・`electron-builder.yml:57-61`

遮断/不在(=強み):ローカルML(STT/埋め込み/VAD)は `allowRemoteModels=false`、同梱音声エンジンは `--disable_sentry`＋dead proxy(`127.0.0.1:9`)＋`HF_HUB_OFFLINE`＋BERT 事前配置で外向き遮断、`crashReporter`/telemetry はコード皆無、`shell.openExternal` は固定2URLのみ。

**静的に潰せない唯一の穴**:Chromium 本体の暗黙通信(variations / component-update / SafeBrowsing)を**明示無効化するコードが無い**。→ **Phase 2 実機キャプチャで確定すべき最重要項目**。

### 0.2 文書と実装の主要矛盾(売り文句のワナ)
| # | 文書の主張 | 実装の実態 | 扱い(決定) |
|---|---|---|---|
| 1 | 「配布サイズ100MB以下」(CLAUDE.md §4.3) | extraFiles でモデル/エンジン**約1.5GB**同梱。"コア<100MB"は別概念 | **「軽量100MB」は売りにできない**。文書を「コア軽量＋アセット同梱」へ是正 |
| 2 | (暗黙)署名済み配布 | **コード署名なし**=未署名NSIS→SmartScreen 警告前提 | 配布体験の正直な前提として明記 |
| 3 | 「削除機能は完全削除」「アプリ内『完全に削除』操作」(§6.4 / installer コメント) | **DELETE_ALL IPC が存在しない**。削除=手動フォルダ削除＋アンインストール | **決定=実装せず文書を実態へ**(§6.4・installer コメント是正) |
| 4 | 「忘却で常時≤1000件」(constants コメント/監査メモ) | 件数カウンタ・1000閾値とも**実在せず**。忘却は時間×重要度のみ | **決定=キャップ足さず、実態(人間らしい忘却)を文書化**。理由は §3 と別紙 |
| 5 | 「Knowledge Router disabled / 0ms」(docs) | 実際は**ローカル判別器に置換され機能**(ネットワーク0往復で話題判定) | docs を「ローカル判別へ置換」へ是正(嘘でなく更新漏れ) |

### 0.3 実バグ・死にコード候補
- **[修正済 `48c3958`]** `init-directories.ts` が config/logs を install dir 側に作っていた(N-REL-2 追従漏れ)→ getter 正本化で是正。
- **[修正済 `780d07a`]** 全 web contents のナビ/新窓ガード未設置 → `web-contents-created` で deny を追加。
- **[修正済]** 自発系3経路(自発発話・起動挨拶/offscreen-life・dev trigger)が AI自称検知の第2/3層を通らなかった非対称 → 自発系に第2層を追加して閉鎖(idle-talk=検知時に黙る/起動挨拶=null で定型へ・成功基準8)。§10.2 参照。
- **[要externalize]** エラー時キャラ口調文がコード直書き(`fallback.ts`・`ipc.ts`×3・`use-voice-input.ts`)。`fallback.ts` 自身が TODO 化。
- **[死にスクリプト]** `package:portable`(`package.json:13`)は yml に portable target が無く宙吊り。
- **[スタコメント陳腐化]** `ai-self-check.ts`「4層」(実3層)/ `recall-pool.ts`・`life-memory.ts` の削除済 `user-tone` 参照 / `constants.ts` junction 記述 / `lifecycle.ts` の存在しない `ENE_IDLE_TALK` / `turn-engine.ts`「OSコマンド実行」化石 / `encryption.ts` の旧 data/app リダイレクト記述 / `paths.ts` の getEngineUserDataDir junction 記述。

### 0.4 実機(Phase 2)で確定すべき項目
1. electron-updater の実宛先(GitHub 系)と**送信内容が GET のみ・識別情報なし**か。
2. **Chromium 暗黙トラフィック**(variations/component-update/SafeBrowsing)が出るか。出るなら追加遮断検討。
3. 同梱音声エンジンの **outbound 実遮断**(dead proxy+offline が AivisHub/HF/Sentry を全て connection refused にするか)。標準版 AivisSpeech 同居時も同様か。
4. NSIS package/install/update/uninstall(`installer.nsh` の AivisSpeech 掃除・記憶保持・未署名 SmartScreen)。
5. エンジンデータの `%APPDATA%\AivisSpeech-Engine` への place-if-missing 配置(ハードリンク/別ボリュームでコピー)。
6. (C2 校正)抽出器の **importance 分布**=忘れすぎ/残しすぎの実測。

---

## 1. 外部通信 / egress

| 事実 | 根拠 | 分類 | shipped-default |
|---|---|---|---|
| Claude クライアントは baseURL=`https://api.anthropic.com` を**明示固定**(全経路 `createClient` 経由) | `client.ts:33,37` | [静的確認済] | 唯一の意図された egress |
| 会話/抽出/要約/ウォーム/ping が同じ固定 baseURL | `client.ts:37,92,123,145,194`・`api-key-tester.ts:16` | [静的確認済] | both |
| Claude 以外への HTTP/WS クライアント(axios/undici/node-fetch/http.request/WebSocket)は**コード上不在** | grep 0件 | [静的確認済] | — |
| 自動更新=`electron-updater`(`checkForUpdates`→同意→`downloadUpdate`→`quitAndInstall`) | `auto-update.ts:34-75,98` | [静的確認済] | packaged のみ |
| 更新フィード=**GitHub**(owner `HaneruAzuki`/repo `ene-desktop`)。URL ハードコードなし=provider 由来 | `electron-builder.yml:57-61` | [静的確認済] | packaged |
| 更新チェックは `app.isPackaged` でゲート(**dev では一切通信しない**)・`autoDownload=false`・`logger=null` | `auto-update.ts:31,34-36` | [静的確認済] | dev/prod 差あり |
| 埋め込み(ruri)/STT(whisper)とも `allowRemoteModels=false`＋`localModelPath` 固定=実行時に外部DLしない | `embedder.ts:42`・`stt-pipeline.ts:38-40` | [静的確認済] | both |
| HuggingFace 実DLは **setup スクリプトのみ**(`scripts/download-*.mjs` 手動)。postinstall 等の自動フック無し | `download-stt-model.mjs`・`package.json:19-21` | [静的確認済] | アプリ実行時は起きない |
| 同梱エンジンを `spawn`(shell:false・固定パス・引数配列)＋`--disable_sentry` | `voice-engine.ts:143-154` | [静的確認済] | both |
| エンジン子へ dead proxy(`127.0.0.1:9`)＋`NO_PROXY=127.0.0.1,localhost`＋`HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE` を注入 | `engine-userdata.ts:215-227`・`constants.ts:429`(`VOICE_ENGINE_DEAD_PROXY`) | [静的確認済] | both(実遮断は要実機) |
| TTS クライアントは `127.0.0.1:10101` のみ(`/synthesis`,`/speakers`,`/audio_query`,`/version`) | `aivisspeech-tts.ts:92,103,113` | [静的確認済] | both |
| `crashReporter`/`setUploadToServer`/telemetry は**リポジトリ全体で 0件** | grep 0件 | [静的確認済] | — |
| `shell.openExternal` は**固定2URL のみ**(Anthropic コンソール/請求) | `api-key-dialog.ts:13,41`・`settings-ipc.ts:56` | [静的確認済] | both |
| CSP `connect-src 'self' blob:`(レンダラから外部 origin への XHR/fetch 不可) | `renderer/index.html:11` | [静的確認済] | both |

**[疑わしい/静的に断定不可]** Chromium 本体の variations/component-updater/SafeBrowsing を明示無効化するコードが無い(`--disable-features` 等 grep 0件)。crashReporter は不在で確実遮断だが、Chromium 既定の暗黙通信は静的に否定できない=**Phase 2 必須**。

---

## 2. データ保存 / 暗号化

| 事実 | 根拠 | 分類 |
|---|---|---|
| 保存先 SSOT は `paths.ts`。userData(記憶/設定/APIキー/ログ)と portable(同梱アセット読取専用)を分離 | `paths.ts:50-67` | [静的確認済] |
| `getUserDataDir()`:本番=Electron userData(`%APPDATA%/project-ene`)/ 開発=`cwd/data` | `paths.ts:64-67` | [静的確認済] |
| `getPortableDataDir()`:本番=install dir 隣 `data/` / 開発=`cwd/data`(モデル/エンジン読取専用) | `paths.ts:58-61` | [静的確認済] |
| userData 識別子を `app.setName('project-ene')` で ASCII 固定(表示名「魚川トリミ」と分離) | `index.ts:15` | [静的確認済] |
| 記憶=`{userData}/memory/{characterId}/`(episodic/semantic/short-term/consolidation-state/open-loop-state/index) | `paths.ts:139-183` | [静的確認済] |
| 設定/ログ=`{userData}/config/`・`{userData}/logs/main.log`(平文) | `paths.ts:69-134` | [静的確認済] |
| **APIキーのみ** safeStorage(Windows=DPAPI)暗号化=`{userData}/api-key.enc`。復号失敗は null(別PCは再入力) | `encryption.ts:18-42`・`paths.ts:253-260` | [静的確認済] |
| 記憶・設定・ログは**平文 JSON**(`writeJson` は暗号化なし・tmp→rename アトミック・親dir自動作成) | `json-store.ts:33-48` | [静的確認済] |
| エクスポート/インポート=`memory`+`config` の2つ(**APIキーは含めない**)。設定パネルから明示起動 | `user-data-backup.ts:21,31-56`・`settings-ipc.ts:82-125` | [静的確認済] |
| アンインストール時 userData(記憶)は `deleteAppDataOnUninstall:false` で**既定保持** | `electron-builder.yml:55` | [静的確認済] |
| ログ衛生:会話本文/プロンプト/記憶を記録しない。conversation client は token 数とエラー名のみ | `logger.ts:5-8`・`client.ts:107-111` | [静的確認済] |
| **[修正済 `48c3958`]** `init-directories` が config/logs を install dir 側に作っていた→ getter 正本化(userData)で是正 | `init-directories.ts`(現状) | [静的確認済] |

**[矛盾]** §6.4「アプリ内の完全削除操作」は **未実装**(DELETE_ALL IPC 不在)→ **決定=文書を実態へ**。
**[スタコメント]** `encryption.ts:10-12`・`paths.ts` getEngineUserDataDir 等に旧ポータブル/junction 記述残。

---

## 3. 記憶システム(HEAD 780d07a・再センサス)

> 並走改修(valence 撤去/心簡素化/open-loops 再設計)を反映。**忘却スケジュールは不変**。

| 事実 | 根拠 | 分類 |
|---|---|---|
| 記憶3種:短期(`short-term.json`・上限40・抽出済みのみトリム)/中期(episodic=ファイルパスがID)/長期(semantic) | `short-term.ts:8-9,38-48`・`episodic.ts:27-29` | [静的確認済] |
| **valence フィールドは型・抽出・想起・忘却から完全撤去**(残はコメント3箇所のみ) | `memory.ts`(valence無)・`mood-cues.ts:3`等 | [静的確認済] |
| `user-tone.ts` 削除=`recentUserTone`(valence減衰平均)機構は消滅。retriever スコア式は `RRF+関心アフィニティ` のみ | `retriever.ts:205` | [静的確認済] |
| 「心」は `mood-cues.ts` 新設=**現ターン発話**の cue で落ち込み検出→moment ヒント(`lowMoodHint`)。状態を貯めない | `mood-cues.ts:8-40`・`context-builder.ts:87`・`prompt-builder.ts:305-307` | [静的確認済] |
| 想起=RRF(語彙/entity + ベクトル)合流(`RRF_K=60`)。ベクトル失敗時は語彙のみ | `retriever.ts:188-196`・`constants.ts:102` | [静的確認済] |
| 関心アフィニティ加点(`INTEREST_AFFINITY_WEIGHT=0.01`) | `retriever.ts:198-206`・`constants.ts:327` | [静的確認済] |
| **softmax 揺らぎ復活**(`RECALL_SOFTMAX_TEMP=0.006→0.012`)。候補プール `=8` でハード切り後にサンプリング | `constants.ts:336,343`・`retriever.ts:211-215` | [静的確認済] |
| 多様性選抜 `RECALL_TOPIC_MAX=2`・安全網は「直近×高importance」user のみ(canon除外) | `retriever.ts:218-230`・`constants.ts:351` | [静的確認済] |
| ベクトル想起の自己回復(連続失敗3超で一時停止・20回ごと再試行・成功で完全リセット) | `retriever.ts:43-50,99-144` | [静的確認済] |
| **open-loops 再設計**:状態を `surfaced:string[]` へ簡素化。能動提示は最大1件・以降は想起で再浮上時に prompt が「まだ結末を聞いていない」を添える | `open-loops.ts:7-71`・`prompt-builder.ts:114-116`・`constants.ts:505` | [静的確認済] |
| 抽出 provenance(user/self)判定＋主人名を「ユーザー」総称化(名前を記憶に焼かない)＋`lockOwnerName` | `extractor.ts:67-75`・`extraction-trigger.ts:131-133` | [静的確認済] |
| 抽出はバックグラウンド(未抽出8で発火・直列化・coalesce)。短期ハード上限80で同期抽出強制 | `extraction-scheduler.ts`・`constants.ts` | [静的確認済] |
| 近似重複マージ(cos≥0.92・14日・同category・同provenance) | `episodic-dedup.ts:40-66` | [静的確認済] |
| embedder ローカル限定(`allowRemoteModels=false`)・パストラバーサル防御(`..`/絶対/境界の多段) | `embedder.ts:42`・`episodic.ts:35-40` | [静的確認済] |
| **「心」は保存スカラーなし**(mood/好感度フィールドはコード上に存在しない) | `mood-cues.ts`(状態なし)・`familiarity.ts:15` | [静的確認済] |
| `familiarity`(親しさ=開示段階)は接触の事実(経過日数AND会話実日数ANDターン累計)から導出・単調非減少 | `familiarity.ts:15`・`constants.ts:381-390` | [静的確認済] |

**忘却スケジュール(C2 検証・不変)**
| 段 | 対象 | 削除 importance | サマリ importance | 根拠 |
|---|---|---|---|---|
| 月次 | 完了月・`年差<2` | `≤2` 物理削除 | 4 | `consolidation-policy.ts:127-135`・`constants.ts:60,64` |
| 年次 | `年差≥2`・年次サマリ未作成 | 月次サマリ全削除＋生記録 `≤3` | 5 | `consolidation-policy.ts:104-119`・`constants.ts:62,66,68` |
| daily-life(canon の暮らし断片) | `≥2ヶ月` かつ `≤2` | 要約せず直接削除 | — | `consolidation-policy.ts:141-145`・`constants.ts:475,483` |

- 忘却は**常時オン**(env トグル撤去)・起動時に無条件実行。要約失敗した期間は削除しない安全設計。`forgetting.ts:25,99-117,155-166`
- **件数キャップ(≤1000)は不在**=有界性は importance×時間ベース。→ **決定=キャップ足さず実態を文書化**。

**[疑わしい/スタコメント]** `recall-pool.ts:10-11`・`life-memory.ts:10` が削除済み `user-tone`/`recentUserTone` を現役前提で参照(動作影響なし)。

---

## 4. キャラクターシステム

| 事実 | 根拠 | 分類 |
|---|---|---|
| 単一固定キャラ。`CHARACTER_ID='ene'`(唯一SSOT)。切替UIなし | `constants.ts:11`・`character-state.ts:14-28` | [静的確認済] |
| プロファイルは4ファイル(identity/background/knowledge_domains/fewshot)を読込。欠損・characterId 不一致は例外(自動回復しない) | `loader.ts:28-75` | [静的確認済] |
| `ene/` JSON 群:identity/background/knowledge_domains/fewshot/voice/vrm/current-state/backchannels/life-memory/off-screen-life。表示名 `name:"魚川トリミ"`、内部 characterId は `"ene"` | `ene/identity.json:2` 他 | [静的確認済] |
| **キャラ依存値は JSON 外出し**(名前・口調・知識境界・Few-shot・声・VRM・関心キーワード)。system-prompt 構築コードにキャラ名/口調の直書きなし(変数展開のみ) | `system-prompt-builder.ts:30-84` | [静的確認済] |
| **AI自称防止3層**:①プロンプト(`neverCallsSelf`明示)②応答後検知(非ストリーミング=メッセージ単位/ストリーミング=文単位C2)③検知時フォールバック(再生成なし)。検知語は identity.json 由来=ハードコードなし | `client.ts:233-260`・`voice-chat.ts:70`・`ai-self-check.ts:13-37` | [静的確認済] |
| 誕生日は二値(today/forgotten)＋ `birthdayHistory` の celebrated フラグのみ。感情スカラーなし | `birthday-checker.ts:10-38` | [静的確認済] |
| **保存される感情/好感度スカラーは型にもデータにも存在しない**(character-state.json は事実記録のみ) | `character.ts:108-117` | [静的確認済] |

**[部分逸脱]** エラー時キャラ口調文がコード直書き(`fallback.ts:8`・`ipc.ts:53,374,380`・`use-voice-input.ts:144`)=「100%外出し」とは言えない。`fallback.ts` 自身が外出し未完を TODO 化。
**[スタコメント]** `ai-self-check.ts:1` ヘッダが「4層/第2層」のまま(実装は3層)。

---

## 5. 音声(TTS / STT / VAD / 相槌 / 傾聴)

| 事実 | 根拠 | 分類 |
|---|---|---|
| TTS=AivisSpeech サイドカー(localhost)。既定の声 styleId=1736267264(`model:"torimi"`・単一neutral) | `voice.json:2-15`・`aivisspeech-tts.ts:88-99` | [静的確認済] |
| 声色補正 EQ(9バンド・F0不変)を再生グラフへ挿入(応答・相槌の双方) | `voice-eq.ts:23-39`・`audio-player.ts:78-87` | [静的確認済] |
| **STT 既定=kotoba-whisper-v2.2(ONNX・q8)**。`ENE_STT_MODEL_DIR` で切替。完全ローカル・日本語固定・16kHz | `constants.ts:113,120`・`stt-pipeline.ts:38-47` | [静的確認済] |
| STT worker 分離は**既定OFF**(`ENE_STT_WORKER=1` で有効・未設定/失敗で in-process) | `stt-worker-client.ts:17-18` | [静的確認済] |
| VAD=Silero **v4**(v5 は onnxruntime-node で誤計算ゆえ不採用)。ヒステリシス+デバウンス+最小無音(ターン終了800ms) | `silero-vad.ts:5-9`・`vad-segmenter.ts:72-99` | [静的確認済] |
| **barge-in**:応答中の発話開始で即停止し「聞かせた分」のみ記憶。エコー対策500msデバウンス | `vad-runtime.ts:242-251`・`voice-turn-coordinator.ts:228-242` | [静的確認済] |
| 相槌=VAD 確率列から「言いよどみ→再開」で発火(B-17)。完全ローカル。`backchannels.json` continuer 必須 | `backchannel-engine.ts:85-130`・`backchannel-loader.ts:31` | [静的確認済] |
| 思考フィラー(「うーん…」)=問いの性質(相談形/medium・low 16字超)で発火 | `thinking-filler.ts:33-39` | [静的確認済] |
| ターン終端うなずき(発話長で深さ2段 0.4/0.8・STT を待たない) | `turn-nod.ts:14-16`・`vad-runtime.ts:266-279` | [静的確認済] |

**env 既定(この領域はフラグ多)**:`ENE_VOICE_STREAMING`(既定ON・音声ストリーミング第一声短縮)/`ENE_TWO_TIER`(既定ON・雑談Haiku/難題Sonnet)/`ENE_COALESCE`(既定ON・投機生成＋無音窓適応)/`ENE_LISTENING`(既定ON・傾聴モード)/`ENE_STT_WORKER`(既定OFF)。
**[連鎖前提]** ストリーミング/コアレッシング/相槌/傾聴は「音声有効＋VAD/STT モデル配置済み」が前提。欠ければ静かに無効化しテキストのみ=**要実機(配置確認)**。
**[現役・誤判定訂正]** `applyAccent` は**死にコードではない**(refuter で REFUTED):全TTS合成で呼ばれ、相槌/フィラーの語ごとアクセント補正に実効(`aivisspeech-tts.ts:91`・`backchannel-controller.ts:171`・`backchannels.json` の `accents` 由来)。`accent` 未指定時に短絡するだけ。

---

## 6. 存在感 / アニメーション / 自発的ふるまい

| 事実 | 根拠 | 分類 |
|---|---|---|
| キャラ表示=**VRM(@pixiv/three-vrm)一本**。PNG立ち絵は撤去済(分岐なし)。出せない時は文字メッセージのみ | `CharacterDisplay.tsx:8-12`・`vrm-loader.ts:14-15` | [静的確認済] |
| `torimi.vrm`/`vrm.json` 実在。フレーム上限(発話30fps/アイドル15fps)・非表示で描画停止 | `vrm-renderer.ts:57-59,356-366` | [静的確認済] |
| 表情=emotion→VRMプリセット重み(JSON駆動・ハードコードなし) | `expression-resolver.ts:25-36` | [静的確認済] |
| **off-screen-life は配線済み・出荷済み**(同梱パック `2026-Q3/Q4/evergreen`・週次選択4段フォールバック)。起動挨拶生成＋episodic 吸収(provenance:self)＋気にかけに実配線 | `offscreen-life.ts:98-114`・`offscreen-life-select.ts:76-106`・`lifecycle.ts:235` | [静的確認済] |
| **自動配信(GitHub)分の data/ マージは未実装**=現状は同梱パックのみ(段階的実装) | `offscreen-life-pack.ts:12` | [静的確認済] |
| 起動挨拶=定型文(経過日数で棚分け)を即用意し、LLM 生成を最大8秒待って差し替え(超過/失敗/初回は定型) | `greeting.ts:18-47`・`lifecycle.ts:227-245`・`constants.ts:492`(GREETING_GENERATION_TIMEOUT_MS=8000) | [静的確認済] |
| アイドル発話=60秒tick・多重ANDガード(静音23-8時/1日3回/最小90分/直近会話8分空き/在席90秒/材料あり)。設定 `idleTalk` 既定 `'on'` | `idle-talk.ts:33-45`・`idle-talk-manager.ts:79-115` | [静的確認済] |
| ターン終端うなずき/あくび(傾聴10分)/傾聴の首かしげ/離席=真後ろ等の非言語信号(IPC で会話状態に連動) | `turn-nod`・`vrm-renderer.ts:264-286` | [要実機確認](数値の見栄え) |

**[スタコメント]** `lifecycle.ts:181` が存在しない `ENE_IDLE_TALK` を参照(実制御は `settings.idleTalk`)。

---

## 7. 会話パイプライン(Claude 呼び出し)

| 事実 | 根拠 | 分類 |
|---|---|---|
| モデル2種:`MODEL_SONNET='claude-sonnet-4-6'` / `MODEL_HAIKU='claude-haiku-4-5'`。既定会話=Sonnet | `client.ts:19-22` | [静的確認済] |
| 二段生成:`high`/`refuse` か発話長>40字で Sonnet、他は Haiku(`ENE_TWO_TIER` 既定ON、OFFで全Sonnet) | `model-selector.ts:25-29`・`turn-engine.ts:77-79` | [静的確認済] |
| **補助LLM呼び出し(記憶抽出/要約/自発発話/offscreen-life/挨拶生成/忘却/ウォーム)は全て Sonnet 固定** | `client.ts:122-133`・`lifecycle.ts:141,159,240` | [静的確認済] |
| 音声ストリーミング既定ON(音声有効時)。SDK `stream:true`→JSONを逐次パース→文単位TTS。失敗時は非ストリーミングへ | `turn-engine.ts:86-104`・`json-stream-parser.ts:35-157` | [静的確認済] |
| thinking は両モデル `disabled`。Sonnet のみ `output_config:{effort:'medium'}`。`temperature=0.7`・`max_tokens=1024` | `client.ts:23-26,82-85` | [静的確認済] |
| **Knowledge Router はローカル判別器に置換(ネットワーク0往復)**。`classifyTopicLocal`=キーワード→埋め込み(threshold 0.55)→fallback medium。旧 Haiku 往復 Router は src から削除済 | `local-classifier.ts:14-21,112-157`・`turn-engine.ts:72` | [静的確認済] |
| **prefill 不使用**(Claude 4.x の400回避)。応答テキストを三段パース(フェンス除去→`{}`抽出→JSON.parse)＋型ガード | `client.ts:112-113`・`llm-parse.ts:13-24` | [静的確認済] |
| API失敗フォールバック=キャラ口調固定文。401/402/429 で `onAuthError`(ダイアログ再表示) | `fallback.ts:7-9`・`client.ts:51-55,240-251` | [静的確認済] |
| プロンプト=Tier0(人格+規範+出力形式+自称制約)/semantic/固定few-shot/揮発(moment・episodic・behavior・誕生日)。Tier0・few-shot・履歴境界に `cache_control:ephemeral` | `prompt-builder.ts:224-244,329-372` | [静的確認済] |
| episodic は provenance で「自分の思い出(self)」「相手のこと(user)」を2セクション分離注入 | `prompt-builder.ts:124-140` | [静的確認済] |

**[矛盾]** docs「Router disabled/0ms」は誤読を招く→「ローカル判別へ置換」へ是正。
**[修正済]** AI自称検知の非対称(§10.2)を解消:`makeLlmComplete` を喋る自発系3経路に第2層を追加(idle-talk=黙る/起動挨拶=定型へ)。本会話＋自発系の両方で検知が効く。
**[スタコメント]** `turn-engine.ts:117` に「OSコマンド実行」化石コメント(実装に os_command 経路なし)。

---

## 8. 配布 / 更新

| 事実 | 根拠 | 分類 |
|---|---|---|
| パッケージング=**NSIS のみ**(oneClick/perMachine:false=ユーザー領域・UACなし)。`package:portable` は yml に target 無く宙吊り | `electron-builder.yml:37-55`・`package.json:13` | [静的確認済] |
| 更新=electron-updater・provider github(HaneruAzuki/ene-desktop)。起動時1回・準備フェーズ先頭・dev 無効・8秒タイムアウト | `auto-update.ts:30-51`・`lifecycle.ts:179` | [静的確認済] |
| 「今すぐ更新/あとで」ダイアログ(トリミ口調)は準備完了**前**にのみ。`autoDownload=false`・`logger=null`・GET のみ設計 | `auto-update.ts:80-103,17-20` | [静的確認済]/[要実機] |
| **コード署名なし**(sign/certificate/csc 設定が全ファイルで 0件)=未署名NSIS→SmartScreen 警告前提 | grep 0件 | [静的確認済] |
| アンインストール:`deleteAppDataOnUninstall:false`(記憶保持)＋ `installer.nsh` が `%APPDATA%\AivisSpeech-Engine` のみ除去 | `electron-builder.yml:55-56`・`installer.nsh:39-72` | [静的確認済]/[要実機] |
| appId=`io.github.haneruazuki.project-ene`・productName=`魚川トリミ`・version=`1.0.0`・artifact=`Torimi-Setup-${version}.exe`・locale=ja/en-US | `electron-builder.yml:1-4,62-63,88-90` | [静的確認済] |
| **モデル/エンジン(計約1.5GB)は extraFiles で exe 隣 `data/` に同梱**(初回DLでない)。download/setup スクリプトはビルド時専用 | `electron-builder.yml:64-86`・`download-model.mjs:4-7` | [静的確認済] |
| 起動時 `prepareEngineUserData` が同梱 torimi+BERT を `%APPDATA%\AivisSpeech-Engine` へハードリンク/コピー配置(place-if-missing・旧junction廃止) | `engine-userdata.ts:156-206` | [静的確認済]/[要実機] |

**[矛盾]** 「配布100MB以下」(§4.3)と実配布(コア＋約1.5GBアセット)は乖離=設計選択(コア軽量＋アセット同梱)として文書是正。

---

## 9. セキュリティ姿勢

| 事実 | 根拠 | 分類 |
|---|---|---|
| 全 BrowserWindow(メイン・APIキーダイアログ)が `contextIsolation:true / nodeIntegration:false / sandbox:true` | `window.ts:25-27`・`api-key-dialog.ts:79-84` | [静的確認済] |
| 権限ハンドラは `media` のみ許可・他全拒否(`setPermissionRequestHandler`＋`CheckHandler`) | `window.ts:40-43` | [静的確認済] |
| contextBridge 露出は `window.ene`(約40)＋`window.eneApiKey`(4)のみ。生 ipcRenderer 非公開。renderer は Node/FS に触れない | `preload/index.ts:9-121` | [静的確認済] |
| IPC チャネルは SSOT 定数表(綴りズレをコンパイル時検出)。APIキーは renderer へ渡さない | `ipc-channels.ts:10-62`・`ipc.ts:38-39` | [静的確認済] |
| 入力検証が LLM 由来データに多層:記憶パス traversal 4段＋correction targetFile 二重＋voice baseUrl スキーム検証＋応答JSON 型ガード | `episodic.ts:42-69`・`update.ts:33-36`・`voice-loader.ts:23-39`・`response-parser.ts:8-17` | [静的確認済] |
| 危険API不在:`child_process` は3箇所すべて `shell:false`・固定パス・引数配列(run.exe/taskkill/PS孤児掃除/STTワーカ)。`exec`/`shell:true` でユーザ入力を流す経路なし | `voice-engine.ts:143-154`・`voice-engine-orphan.ts:74`・grep | [静的確認済] |
| **OS操作は型レベルで撤去**(`ConversationResponse.type` は `'chat'` のみ。os_command/action 型なし) | `conversation.ts:9-15`・grep 0件 | [静的確認済] |
| CSP=`default-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob:; style-src 'self' 'unsafe-inline'`。本番は loadFile のみ | `renderer/index.html:9-12`・`window.ts:46-51` | [静的確認済] |
| **[追加済 `780d07a`]** `web-contents-created` で全 web contents に `setWindowOpenHandler=deny`＋`will-navigate` をローカル画面以外へ拒否 | `index.ts`(現状) | [静的確認済] |

**[スタコメント]** `encryption.ts:10-12` の旧 data/app リダイレクト記述(実挙動は userData)。

---

## 10. 反証レビュー結果(v0→v1・5並列 refuter)

**総評**:9ドメインを5スライスに分け敵対的に反証(各「台帳は誤りと仮定し、コードで反証せよ」)。**REFUTED(虚偽)=0**。主要主張(egress 2系統・telemetry 不在・記憶/忘却の数値・3層自称防止・JSON外出し・ローカル判別0往復・prefill不使用・env既定値・Electron 多層防御)はすべて実装と一致。**env フラグ既定値の取り違えゼロ**。指摘は引用ズレ・過大表現・見落とし追記・1件の死にコード誤判定に限られ、結論は維持。

### 10.1 訂正(引用・表現)
- [§1] エンジン dead proxy 根拠 `constants.ts:442`→**`:429`**。TTS の localhost 固定根拠に **`voice.json:3`** を併記すべき(`aivisspeech-tts.ts` はパス部のみ)。
- [§2/§9] 「ログ衛生」の根拠は `logger.ts`(素通しラッパ=サニタイズしない)ではなく**各 call site の規律**。全 log 走査で本文/プロンプト/記憶の漏れは無し(結論維持)。
- [§9] CSP は **meta タグのみ(ヘッダ CSP なし)**、かつ**2種**(メイン窓＋APIキーダイアログ・後者はより厳格)。`window.ts:46-51` は CSP を設定していない(loadFile/loadURL のみ)。
- [§9] orphan の PowerShell は「固定引数」でなく**アプリ管理値を埋め込む動的 `-Command`**(ユーザ/LLM入力なし・単一引用符エスケープ済・shell:false)=実害なし。
- [§1/§9] voice baseUrl 検証は **capability は任意 http/https ホスト許容**(shipped-default は voice.json で localhost)。
- [§6] GREETING_GENERATION_TIMEOUT_MS 根拠 `:505`→**`:492`**。§3 の open-loops 周辺で `:505` を引く箇所も撤去済み定数を指す=要再引用。
- [§7] モデルIDは実コードに**3種**:会話の `claude-sonnet-4-6`/`claude-haiku-4-5` に加え、APIキー ping は**日付ピン留め** `claude-haiku-4-5-20251001`(`api-key-tester.ts:18`)。「2種」「補助は全Sonnet」は会話系に限る注記が要。
- [§0.3/§4] 直書きキャラ口調文は列挙より多い:`ipc.ts` は**4箇所**(53,368,374,380)＋`turn-engine.ts:35`(NOT_READY)。

### 10.2 実質訂正
- **[§5] `applyAccent` は死にコードでない(REFUTED)**:全TTS合成で呼ばれ、相槌/フィラーの語アクセント(`backchannels.json` の `accents` 由来)に実効。死にコード候補から削除。
- **[§0.3/§7] AI自称検知の非対称は idle-talk だけでない(過小評価を訂正)**:`makeLlmComplete` の生テキストを喋る**自発系3経路**(自発発話・**起動挨拶/offscreen-life 生成**・dev trigger)が第2/3層を通らない。特に**起動時に喋られる挨拶が検知外**。3層は「ユーザー送信への応答」にのみ効き、トリミが自分から口を開く系は第1層(プロンプト `neverCallsSelf` 明示)頼み。**新たな品質判断項目**(成功基準8)→ **[修正済]**:自発系3経路に第2層を追加(idle-talk=検知時に黙る/起動挨拶=null で定型へ・第3層)。本会話＋自発系の両方で検知が効くようになった。なお `detectAiSelfReference` は `includes()` の単純部分一致(テンプレ8種)で語形バリエーション/英語は素通り=検知カバレッジは限定(既知の残課題)。

### 10.3 見落とし(MISSING・追記)
- [§3] `impression`(P5・主観の受け取り・summary と分離したテキスト)が現役(`memory.ts:24-28`・`prompt-builder.ts:111-112`)=valence 撤去後に主観を持つ場。
- [§3] open-loops は `surfaced` 集合に加え**全体頻度ゲート2系統**(`lastOpenLoopAt`/`lastGapAt`)＋旧形式からの寛容マイグレーション(`normalizeSurfaced`=移行不要)。
- [§5] STT 空振り時の聞き返し自発発話(`onUnintelligible`・文言は `identity.json` の `unintelligiblePrompts`)が存在感挙動として未記載。
- [§0.3] スタコメント追加:`ipc.ts:233-234` の「PNG 立ち絵へフォールバック」(PNG 撤去後の死記述)。
- [§0.2] docs が**実在しない `ENE_X` フラグ**を「無効化可」と記述(コードに読取なし)=矛盾候補。
- [§0.4] 「Claude のみ」は「SDK が baseURL を尊重する」前提に立つ(推移的依存=`@anthropic-ai/sdk`/electron-updater の実挙動は Phase 2 実機で確定)。

---

## 付録A:env フラグ一覧と既定値
| フラグ | 既定 | 効果 | 根拠 |
|---|---|---|---|
| `ENE_VOICE_STREAMING` | ON(`!=='0'`) | 音声ストリーミング(第一声短縮) | `turn-engine.ts:87` |
| `ENE_TWO_TIER` | ON | 二段生成(雑談Haiku/難題Sonnet) | `turn-engine.ts:77` |
| `ENE_COALESCE` | ON | 投機生成＋無音窓適応 | `ipc.ts:82` |
| `ENE_LISTENING` | ON | 傾聴モード | `ipc.ts:118` |
| `ENE_STT_MODEL_DIR` | 未設定=kotoba-whisper-v2.2 | STT モデル差替 | `stt-transcriber.ts:18-20` |
| `ENE_STT_WORKER` | OFF(`==='1'`) | STT を utilityProcess 分離 | `stt-worker-client.ts:17-18` |
| `ENE_DEBUG_STT` / `ENE_DEBUG_RECALL` | OFF | 診断ログ(永続ログには出さない) | `stt-worker-client.ts:90`・`context-builder.ts:175` |

## 付録B:確認済み「売り文句シグナル」rollup(検証済事実のみ)
- **実行時の会話送信は Claude のみ**(＋packaged の更新チェックは GitHub へ GET・同意制・送信データ無し)。telemetry/crashReporter コード皆無。`ANTHROPIC_BASE_URL` 固定で転送経路を封鎖。
- **ローカルML完結**(STT=kotoba-whisper-v2.2 / 埋め込み=ruri-v3-310m / VAD=silero v4 とも `allowRemoteModels=false`)。録音は外部送信せず STT 入力のみ。同梱エンジンは外向き多重遮断。
- **記憶=平文JSON・パス=ID・索引は再生成可能**(可読/可搬)。エクスポート/インポート。**APIキーのみ DPAPI 暗号化**。
- **アンインストールでも記憶は残る**(`deleteAppDataOnUninstall:false`)。
- **人間らしい忘却**(importance×時間の段階縮退・要約失敗時は消さない)。**心は保存スカラーなし**(現ターンの cue から都度導出)。**改名に強い記憶**(provenance分離＋主人名を焼かない正規化)。
- **キャラ依存値はJSON外出し**(コードに個性を埋め込まない)。**AI自称防止3層**(検知語は identity.json 由来)。
- **Electron 3点セット全窓＋多層防御**(権限 media のみ・nav/新窓 deny・LLM由来データ多層検証・OS操作型レベル撤去)。
- **NSIS 自動更新**(同意制・dev無効)。会話の自然さ(barge-in/相槌/傾聴/ターン終端うなずき)・第一声短縮(ストリーミング＋投機生成＋二段)はローカル判定。

> ※ 体感品質(会話の自然さ・忘却の人間らしさ・声)と、egress の不在・配置・NSIS マクロは本質的に[要実機確認]。Phase 2 で確定する。

---

*v1(敵対的レビュー反映・HEAD 780d07a)。REFUTED=0。残る[要実機確認]は Phase 2 で確定。*

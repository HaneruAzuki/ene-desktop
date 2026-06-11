# 申し送り:キャラ表示の3D化(VRM/three-vrm)実装

> Claude Code 向けの実装ブリーフ。本実装(`CharacterDisplay.tsx` の VRM 化)を担当するためのコンテキスト・決定事項・タスク・参照コードをまとめる。
> 上位規約は `CLAUDE.md`、設計の正本は `docs/03_design.md`、ライセンス台帳は `docs/B_dependency_license_audit.md`。

## 0. ゴール(何を作るか)

立ち絵差分(PNG)に代えて、**VRM 1.0 モデルをデスクトップ小窓にバストアップ表示**し、会話の感情で表情を変え、TTS 音声に口を合わせる。立ち絵経路は**フォールバックとして残す**。ビジョンのロードマップ「1.0 本格モーション(three-vrm)」に相当(`docs/01_vision.md` §6、設計 §11.2)。

## 1. 前提(検証・承認・準備済み)

- **採用可否は計測で確定済み(関門クリア)**:`npm run vrm:smoke` による実機計測で、最重条件(喋りON＋SpringBone ON・30fps上限)で **常駐 CPU 約1%(1コア基準)/ RAM 約410MB / GPU 0.4%**。成功基準7「CPU 3%以下」を満たす。→ **3D化を進めてよい**。RAM 400MB台は最低スペックで要観察だが上限違反ではない(100MB は配布サイズ基準であって RAM ではない)。
- **依存追加・設計更新は承認済み・反映済み**:
  - `package.json`:`three ^0.169.0` ＋ `@pixiv/three-vrm ^3.4.0`(dependencies)、`@types/three`(devDependencies)。three-vrm は純JSなので **vite が `out/renderer` にバンドル**(onnxruntime のような external 化・electron-builder.yml 変更は不要)。
  - `docs/03_design.md` §1.2 に2行＋📌ノート追記済み。`docs/B_dependency_license_audit.md` §2.1 に license 行追記済み(three=MIT / three-vrm=MIT)。
- **モデル**:`characters/model/Torimi.vrm`(VRM 1.0・VRoid 2.13.0製・約31k三角形・10.2MB)。表情プリセットは `happy/angry/sad/relaxed/surprised` ＋ 口形 `aa/ih/ou/ee/oh` ＋ `blink/blinkLeft/blinkRight/neutral` が**全て揃っている**。
  - ⚠️ ライセンスメタが VRoid 既定の `commercialUsage: personalNonProfit` / `avatarPermission: onlyAuthor`。作者=本人なので開発・非商用には支障なし。**有償化する場合は VRoid 側でメタを再設定して再エクスポート**(別タスク)。
- **配置/同梱**:VRM は portrait.png 同様 **exe へ同梱**(`characters/**` は既に `electron-builder.yml` の files/asarUnpack 対象)。最終的な配置パス(`characters/model/` か `characters/ene/`)は実装時に確定し、後述の設定 JSON に書く。

## 2. 参照する“動く実装”

**`scripts/vrm-harness.html`** が three-vrm の配線リファレンス(計測で実証済み)。本実装はここのロジックを React/TS・本体アーキテクチャへ移植する。要点:

- ロード:`GLTFLoader` に `loader.register(p => new VRMLoaderPlugin(p))`、`gltf.userData.vrm` を取得。`VRMUtils.removeUnnecessaryVertices` / `combineSkeletons` / `deepDispose`(破棄時)。VRM0 のみ `VRMUtils.rotateVRM0(vrm)`(本モデルは1.0なので不要)。
- 表情:`vrm.expressionManager.setValue(name, weight)` → 毎フレーム `vrm.update(delta)`(SpringBone/LookAt/Expression を内包)。
- 待機ポーズ:`vrm.humanoid.getNormalizedBoneNode('leftUpperArm'|'rightUpperArm').rotation.z` で腕を下げる、`chest` 微回転で呼吸。**VRM は常に T ポーズで出るのでポーズは実行時に付与**(エクスポートで焼かない)。
- 体の向き:`vrm.scene.rotation.y`。目線は `vrm.lookAt.target = camera` でこちら向き固定。
- カメラ:`head` ボーンのワールド座標から `headY` を取り、バストアップにフレーミング(高さ=パン・距離=z)。
- 軽量化(**必須**):描画は 30fps 上限(時間アキュムレータで間引き)。`scripts/vrm-smoke.mjs` は計測専用(webSecurity:false)で**本体では使わない**。

## 3. 実装タスク

### 3.1 レンダラ(描画)
- `src/renderer/components/CharacterDisplay.tsx` を VRM 版にする。three の WebGL 描画は別モジュール(例:`src/renderer/vrm-renderer.ts`)に切り出し、`CharacterDisplay` は React 側の薄いラッパにする(1ファイル300行目安・CLAUDE.md §8.5)。
- **入力契約は現状維持**:現在の表情入力(`ChatResponse.emotion`: `EmotionLabel`)と「口の開閉(talking)」「mouthFlap タイミング(animation.json の `timing.mouthFlapMs`)」をそのまま受け取り、VRM の表情・口形へ反映する(疎結合・契約を壊さない)。

### 3.2 感情→表情マッピング(ハードコード禁止・JSON 外出し)
- `EmotionLabel`(`neutral/joy/anger/sorrow/embarrassed`)を VRM プリセットへ対応付ける。**コードに埋め込まず** `characters/{id}/vrm.json`(新規・要・animation.json と同様の任意設定)に持たせる(CLAUDE.md §4.5/§5.1)。推奨初期マップ:
  - `neutral→neutral` / `joy→happy` / `anger→angry` / `sorrow→sad` / `embarrassed→relaxed`(`surprised` は将来の状態用に予約)
- 同 JSON に、後述のポーズ・フレーミング初期値・モデル相対パスも持たせる(下記 3.5)。

### 3.3 リップシンク(口パク)
- まずは**既存の時間ベース近似(F-ANIM-05)**を流用:talking 中は `mouthFlapMs` 周期で口形 `aa` の weight を開閉(現行 PNG の open/closed と等価)。これで現行同等の同期になる。
- 余力があれば**振幅ドリブン**へ:renderer の音声再生(`src/renderer/audio-player.ts` で TTS WAV 再生)に `AnalyserNode` を噛ませ、音量で `aa` weight を駆動(設計 §11.1 残課題「振幅ドリブンのリップシンク」)。母音判定までは不要、開口量だけで十分自然。
- 自称防止など既存の応答処理は不変(音声経路の4層防御は完成メッセージ側で担保済み)。

### 3.4 アイドル挙動
- まばたき(`blink` を周期＋ランダム)、呼吸(`chest` 微回転)、look-at(カメラ=正面固定)。すべてハーネス参照。

### 3.5 表示パラメータの調整可能化(ユーザ要望)
- **高さ・距離・向きY・腕の下げ(＋必要なら待機ポーズ角)を実行時に調整可能**にし、値を**設定として保存**する。保存先は既存の設定系(`src/storage/app-settings.ts` / `data/config/`)か `characters/{id}/vrm.json` の既定値＋ユーザ上書き。`%APPDATA%` ではなく `data/` 配下(可搬・平文JSON・設計 §2/§6)。
- 初期値はハーネスで良好だった値を採用(例:距離0.55・向きY18°・腕下げ62°・高さ0。実機で微調整して確定)。
- UI は最小限で可(設定パネル or デバッグ用トグル)。まずは設定値読込→反映が必須、GUI スライダーは任意。

### 3.6 パフォーマンス制御(必須・軽量原則 柱4)
- **30fps 上限**、**非発話・無変化時はさらに間引き(例 ~10fps)か描画停止**、**ウィンドウ非表示/最小化/被覆時は描画を止める**(`document.visibilitychange` / main からの hide 通知)。計測値(CPU~1%)はこの前提込みなので、これらを必ず実装する。

### 3.7 フォールバック
- VRM 未配置・読込失敗・低スペック時は**既存の PNG 立ち絵経路にフォールバック**(`isEmbeddingModelAvailable()` と同様の `isVrmAvailable()` 判定パターン)。`animation.json`/`resolve-frame.ts` の経路は消さず残す。

### 3.8 モデルのロード経路(asar/contextIsolation 対応)
- 本体は webSecurity 通常・contextIsolation 有効・asar 同梱。renderer から直接 fs は読めない。**main で `.vrm` を読み IPC で ArrayBuffer を渡す**(`getCharacterModel()` 等)→ renderer は `GLTFLoader.parse(arrayBuffer, '', ...)`。または専用プロトコル登録。**10MB を base64 data URL 化するのは避ける**(portrait.png の base64 方式=N-09 系とは別扱い)。`characters/**` は asarUnpack 済なのでファイル実体は存在する。

## 4. 守るべき規約(CLAUDE.md 抜粋)

- キャラ属性・マッピング・閾値を**コードにハードコードしない**(JSON 外出し・§4.5/§5.1)。「ENE/魚川トリミ/ツンデレ」等の文字列を埋め込まない。
- 外部送信は Claude API のみ。three-vrm 追加で**新たな外部通信を足さない**(モデルはローカル同梱)。
- TypeScript strict・`any` 原則禁止・関数に型注釈。コメントは**日本語**で「なぜ」を書く。1ファイル300行目安。
- 設計 §1.2 以外のライブラリを**勝手に増やさない**(three/three-vrm/@types/three は承認済。追加が要るなら要承認)。
- 純粋ロジック(感情→表情マップ等)は **vitest** で単体テスト。表情・口パクの自然さは**人手確認**(成功基準8 と同様)。

## 5. 想定タッチポイント(ファイル)

- 変更:`src/renderer/components/CharacterDisplay.tsx`、`src/renderer/App.tsx`(描画切替・パラメータ受け渡し)、`src/main/ipc.ts`/`src/preload/index.ts`(モデル ArrayBuffer の IPC)、設定型(`src/shared/types/settings.ts` 等)。
- 新規:`src/renderer/vrm-renderer.ts`(three-vrm 描画)、`characters/{id}/vrm.json`(マップ＋初期パラメータ＋モデルパス)、必要なら型(`src/shared/types/`)。
- 不変で残す:`characters/{id}/animation.json`・`src/renderer/resolve-frame.ts`(PNG フォールバック)。
- 同梱:`electron-builder.yml` は `characters/**` 同梱済だが、VRM の最終配置パスが確定したら files/asarUnpack の網羅を確認。

## 6. 完了の判定

1. VRM がバストアップで小窓に表示され、ドラッグ移動・最前面・透過が現行同等。
2. 会話の `emotion` で表情が変わる(マップ JSON 経由)。
3. TTS 発話に口が動く(時間ベースで可、余力で振幅ドリブン)。
4. まばたき・呼吸・look-at(正面)・待機ポーズ(腕下げ・向きY)が出る。高さ・距離・向きが調整・保存できる。
5. 30fps上限＋アイドル間引き＋非表示停止が効き、**実機で常駐 CPU 3%以下**を維持(`npm run vrm:smoke` 相当を本体でも確認)。
6. VRM 未配置時に PNG 立ち絵へフォールバックする。
7. 単体テスト(マップ等)green、手動確認で表情・口パクが自然。

## 7. 既知の注意

- three-vrm v3 の API(`expressionManager`/`humanoid.getNormalizedBoneNode`/`lookAt`/`VRMUtils.*`)はハーネスで実証済み。バージョン更新時は package-lock で固定(§2.4)。
- ハーネス(`scripts/vrm-*.{mjs,html}`)と `characters/model/vrm-viewer-test.html` は**計測・確認用の使い捨て**。本実装後は不要なら削除可。
- PowerShell で `npm` が実行ポリシーで止まる場合は `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` か `npm.cmd`。

# Task 17: 双方向ローカル音声(MVP 0.3「声と耳」)

## 目的

Conversation を音声化し、魚川トリミと **双方向の音声会話**(STT＋TTS＋VAD/barge-in)を実現する。
処理は**すべてローカル**(音声は端末外に出さない。脳=Claude へ送るのは**テキストのみ**=§4.2 維持)。
TTS は**差し替え可能インターフェース**で構え、まず**寛容ライセンスの声を同梱**(声優なし・学習なし)する。

> 本タスクの方針は 2026-06-07 のユーザーとの設計セッションで確定(下記「確定した方針」)。
> 詳細な検討経緯は memory `voice-plan-decisions-2026` / `research-voice-stack-2026`。

## 位置づけ・哲学

`docs/00_philosophy.md` ロードマップ **MVP 0.3「声と耳」**。
- **双方向だが"間のあるENE"を保持**:リアルタイム性=B は追わない(§命題・L174)。barge-in は「被せない/聞き終わる」礼儀であって速度競争ではない。
- 声・口・表情(③人間/キャラ天井):**TTS＋振幅ドリブンのリップシンク**(task_13 の時間ベース口パクを差し替え)。
- ターンテイキング(③人間天井):**Silero VAD＋Smart Turn v3.2＋barge-in**。

## 依存タスク(すべて✅完了)

- task_13(アニメ・`talking`状態=リップシンクの土台)
- task_05 / task_14(Conversation Layer・プロンプトキャッシュ)
- task_15(`onnxruntime-node` 同梱基盤=STT/VAD/Turn/TTS の実行土台)

## 確定した方針(2026-06-07)

1. **ルート=ローカルファースト**。脳=Claude(ストリーミング化)、STT・VAD・ターン検出はローカル。**ビジョン§4.2 維持・改訂不要**。
2. **役割=双方向の音声会話**(STT＋TTS、VAD/barge-in)。速さは追わない。
3. **TTS=`TtsEngine` インターフェースで差し替え可能 ＋ 完全ローカル実装から開始**(§4.4)。
4. **声=AivisSpeech(Style-Bert-VITS2系・VOICEVOX互換ローカルHTTP API・localhost:10101)＋クリーンな女性ボイス**。当初の軽量in-process(Kokoro/MeloTTS)案から転換(感情スタイルがキャラ表現に効く・MeloTTSは平坦・Kokoro日本語はg2p不確実)。**性別/音色はモデル選択で決める**(`pitchScale`は0から動かすと音質劣化＝制限)。emotionは**スタイルID切替**で表現し、`intonationScale`/`speedScale`/`tempoDynamicsScale`で調整。声モデルは**同意・再配布クリーン**(つくよみちゃん or 自作AIVM)。**⚠️既定音声Anneliは声優の無断クローン問題(2025-09公開停止・AivisHub閉鎖)で採用不可**。

## アーキテクチャ(turn-based cascade)

```
🎤mic ─▶ VAD(Silero) ─▶ 終話判定(Smart Turn v3.2) ─▶ STT(Whisper/非ストリーミング)
                                                              │ 確定テキスト
                                                              ▼
                                                       Claude(ストリーミング)
                                                              │ 文単位
                                                              ▼
                                              文分割 ─▶ 自称検知(文ごと) ─▶ TTS ─▶ 🔊再生＋リップシンク
   barge-in: 再生/生成中にユーザー発話を検知したら停止
```

- **ストリーミングSTTは使わない**:VAD で発話を区切り、**確定発話を非ストリーミング Whisper で書き起こす**(調査で日本語ストリーミングモデルの実在が未確認=回避)。
- **実行配置(案・Phase 0 で確定)**:renderer=mic取得(`getUserMedia`)/VAD/音声再生、main=Whisper STT/Claude/TTS。PCM の renderer↔main 受け渡しを IPC で設計。

## フェーズ構成

| Phase | 内容 | task_13依存 |
|---|---|---|
| **0 設計・承認** | C1/C2 再設計の設計、新規ライブラリ承認(§2.3＋設計書§1.2/§2/§4 更新案)、STT/VAD/Turn/TTS の実行配置・IPC契約、ビジョン整合確認 | — |
| **A 出力(TTS)先行** | `TtsEngine` IF＋寛容声 in-process 実装/声params JSON/文単位TTS再生キュー(C3)/Conversation のストリーミング化(C1前半)/振幅ドリブンのリップシンク(F-ANIM-05差し替え) | リップシンクのみ |
| **B 入力(STT)** ✅実装 | mic取得(`getUserMedia`/16kHz)/STT=**main+onnxruntime-node+whisper-large-v3-turbo**(embedder同型・ローカル)/push-to-talk→既存`sendMessage`/`download:stt-model`/`media`権限のみ許可。**実機スモーク済**(`npm run stt:smoke`・CPU等倍・日本語良好)。詳細 N-17-8。残=実マイク発話の手動確認 | 不要 |
| **C 双方向・ターン** ✅実装 | **Silero VAD v4**(main+onnxruntime-node・★v5はnode誤計算でv4採用=N-17-9)/沈黙でターン終了→Whisper/確定テキスト→既存sendMessage/**barge-in**(speech-start中はTTS停止・echoCancellation)/listening-recording-thinking-talking 状態機械＋🎧トグル。Smart Turn は沈黙タイムアウトで代替(将来upgrade)。**セグメンタ単体테스트8件**。残=実マイク手動確認(AECの効き) | 不要 |
| **D 仕上げ・受入** | 声の試聴・確定(人間判定)/レイテンシ実測/受入チェックリスト | — |

**段階の狙い**:**A(片方向TTS)で「声が出る」を最小達成**しつつ最難関のストリーミング再設計を地ならし → B → C で全二重へ。

## 最大の技術改修

- **C1 Conversation Layer ストリーミング再設計**:現状の非ストリーミング `ConversationResponse={type,message,emotion}`(`src/shared/types/conversation.ts`)を、**「喋る用プレーンテキストstream」と「os_command 等の構造化出力」に分離**する。プロンプトキャッシュ(task_14)の安定プレフィックスは維持。
- **C2 4層防御 × ストリーミング**:現状は完成メッセージ全体を検知してから返す(`src/conversation/client.ts`)。喋り始めたら取り消せないため、**文単位で TTS 発話前に自称検知**する方式へ(レイテンシと両立)。

## 未決(Phase 0 で確定する)

| # | 論点 | 候補 |
|---|---|---|
| 1 | **STTエンジン構成** | (a) **sherpa-onnx-node**(Apache・Node binding・プリビルド)で STT(Whisper)＋VAD(Silero)を一本化【ただし自前 onnxruntime を持ち**既存 onnxruntime-node と重複**】 vs (b) **既存 onnxruntime-node 再利用**＋個別モデル(whisper/silero/smart-turn)＋TTSは kokoro-js |
| 2 | **TTSエンジン同梱方式** | TTS=**AivisSpeech確定**(VOICEVOX互換HTTP・localhost:10101・LGPL)。重い(torch・GB級)ため **(a)engine初回DL同梱 vs (b)ユーザー各自インストール** を選択。声モデル=**つくよみちゃん採用 vs 自作AIVM**(Anneli除外) |
| 3 | **実行配置** | mic/VAD/再生=renderer、Whisper STT=main(要確定) |
| 4 | **モデル容量・初回DL** | Whisper(small≈466MB等)＋TTS(≈80MB)＋VAD/Turn(数MB)→ コア<100MB のため初回DL |
| 5 | **声の最終採用** | 試聴(人間判定=ユーザー)で確定。pitch/speed を JSON に |

## 承認必須(§2.3 / §14・着手前)

- 新規ライブラリ:`sherpa-onnx`(or `kokoro-js`/whisper binding/Silero/Smart Turn v3.2)→ **設計書§1.2 更新**
- 新リソース配置(音声モデル置き場・声設定JSON)→ **§2 更新**
- 音声IPC/イベント契約 → **§4 更新**
- **§4.2(外部送信はClaudeのみ)は維持=逸脱なし**(音声はローカル処理、テキストのみClaudeへ)

## ライセンス制約(同梱の鉄則)

- 出力モデルの再配布可否は **「エンジン license × 種(seed) license」の両方**で決まる。**種は寛容側から取る**。
- **採用可(寛容)**:Kokoro/MeloTTS/Parler の出力(Apache/MIT)、つくよみちゃんコーパス(商用・再配布OK)、JVNV(CC BY-SA)、Whisper(MIT)、sherpa-onnx(Apache)、Silero VAD、Smart Turn v3.2(BSD)。
- **回避(無料配布に使えない/懸念)**:Fish-Speech(CC-BY-NC)、XTTS(CPML)、**SenseVoice(商用ライセンスに懸念・規約4.2)**、VOICEVOXキャラ声を種にしたクローン(規約)、Style-Bert-VITS2 直接同梱(AGPL→AivisSpeech経由ならLGPL)、**AivisSpeech既定音声Anneli(声優の無断クローン・2025-09公開停止・AivisHub無期限閉鎖)**。

## やってはいけないこと

- ❌ 音声を第三者クラウドへ送る(§4.2 逸脱)。脳へ送るのはテキストのみ。
- ❌ 非商用/再配布不可ライセンスのモデル・声を同梱(Fish-Speech/XTTS/SenseVoice 等)
- ❌ 未検証の日本語ストリーミングSTTモデルに依存(VAD区切りWhisperで回避)
- ❌ 感情・好感度などの保存される数値状態(§5.3)
- ❌ コアを重くする(音声モデルは別DL・コア<100MB維持・§4.3)
- ❌ 新規ライブラリの無断追加(§2.3=承認必須)

## 受入チェックリスト

### 自動チェック(vitest / typecheck)
- [ ] `TtsEngine` インターフェースと寛容声実装の純粋ロジック(文分割・再生キュー)単体テスト
- [ ] C1 ストリーミング応答パースの単体テスト(喋るstream と構造化出力の分離)
- [ ] C2 文単位の自称検知(発話前ゲート)単体テスト
- [ ] 既存 269 テストが回帰しない

### 手動チェック(`npm run dev`・人間判定)
- [ ] 双方向会話が成立(喋る→書き起こし→Claude→声で返る)
- [ ] barge-in(被せ発話で停止)が機能
- [ ] リップシンクが音声振幅に追従
- [ ] **(成功基準8 連動)** 声・間がキャラらしいか — **ユーザー手動判定**
- [ ] 採用声・pitch/speed の確定(試聴)

## 設計書への反映(承認後)

実装中の判断は `docs/implementation-notes.md` に **N-17-x** として記録し、完了時にまとめて反映:
- `02_requirements.md`:F-VOICE-xx を追加
- `03_design.md`:§1.2(音声ライブラリ)、§2(音声モデル/声設定の配置)、§3.4(ストリーミング応答型)、§4(音声IPC)、§11.1 の具体化

---

## 付録:声モデル制作(コーパスから自前のつくよみ声・非コード)

> 配布時にユーザー手動セットアップを求めないため、**自前のつくよみ声 AIVMX を作って同梱**する(戦略c・2026-06決定)。
> これは**非コードのコンテンツ/ML 作業**(立ち絵制作と同種)で GPU 学習を伴う。コードの自動プロビジョナ(`voice-provisioner`)はこの AIVMX を前提に動く。

### 制作手順
1. **コーパス取得**:つくよみちゃんコーパス(無料・著作権法30条の4基盤・CC BY-SA 継承不要)。
2. **学習**:Style-Bert-VITS2(v2.7+)でコーパスを学習(GPU; Colab/ローカル)。
3. **AIVMX 変換**:Style-Bert-VITS2 の ONNX 書き出し or AIVM Generator(ブラウザ)で `.aivmx` 化。
4. **ホスティング**:我々管理の URL に `.aivmx` を置く(アプリの `voice-provisioner.downloadModel()` が初回 DL)。

### ライセンス(確認済み・好材料)＋ 出荷前ゲート
- 30条の4基盤=**ShareAlike 不要・商用 OK**。補足が「**声質を再現した TTS の配布・販売も可**」を明示。
- **別キャラ(魚川トリミ)の声として使用可**(つくよみ"キャラ本人"を騙らなければ OK=キャラクターライセンスは別領域)。
- **クレジット必須**(声質が出力に表れる本用途):
  > Style-Bert-VITS2による音声合成には、フリー素材キャラクター「つくよみちゃん」が無料公開している音声データを使用しています。■つくよみちゃんコーパス（CV.夢前黎）https://tyc.rei-yumesaki.net/material/corpus/
  → アプリ内のクレジット/について画面に表示。
- ⚠️ **出荷前ゲート(開発者判定)**:公開配布の前に、コーパス本利用規約＋キャラクターライセンスの原文を最終確認(モデルファイル同梱可否・禁止事項=なりすまし/誹謗中傷等)。法的サインオフはユーザー責任(manual-check 方針)。

### コードとの接続
- 完成した `.aivmx` を `voice-provisioner.downloadModel()` が `%APPDATA%\AivisSpeech-Engine\Models\` へ配置 → `/speakers` → `buildVoiceConfig` で `voice.json` 自動生成。
- styleId は学習したスタイル数に依存(単一スタイルなら全 emotion=neutral 流用、複数感情を学習すれば自動マップ)。

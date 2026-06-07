# 設計改訂(ステージング):双方向ローカル音声(task_17 / MVP 0.3「声と耳」)

> 本書は **Phase 0 の設計** をステージングするもの。承認後に `03_design.md`(§1.2/§2/§3.4/§4/§11.1)へマージする。
> 上位の確定方針は `tasks/task_17_voice.md` / memory `voice-plan-decisions-2026`。

---

## 0. 確定済みの前提(再掲)

- **ルート=ローカルファースト**。脳=Claude(ストリーミング)。音声は端末外に出さない(§4.2維持・テキストのみClaudeへ)。
- **役割=双方向**(STT＋TTS＋VAD/barge-in)。速さは追わない("間"は残す)。
- **TTS=AivisSpeech**(Style-Bert-VITS2系・VOICEVOX互換HTTP・localhost:10101・LGPL)。`TtsEngine`はHTTPクライアント。
- **声=クリーンな女性ボイス**:**つくよみちゃん**(商用/再配布OK・既存SBV2モデル→AIVM化)→ 将来**自作AIVM**。**Anneli不可**。
- **エンジンの届け方=管理サイドカー**(初回起動時に自動DLして子プロセス起動・手動インストール不要・コア<100MB維持)。

---

## 1. アーキテクチャ(turn-based cascade ＋ 実行配置)

```
[Renderer(web)]                         [Main(node)]                       [Sidecar]
 mic getUserMedia ─PCM frames(IPC)─▶  Silero VAD ─▶ 発話確定               AivisSpeech
 音声再生(Web Audio) ◀─audio chunks─   (＋Smart Turn v3.2 でセマンティック    Engine
 barge-in 検知 ─stop(IPC)─▶            終話・v1.1)                          (localhost:10101)
                                       └▶ STT(Whisper) ─text─▶ Claude(stream)
                                                                  │ 文単位
                                                       文分割→自称検知→ POST /audio_query→/synthesis
                                                                  └─WAV─▶ 再生キュー(IPC)─▶ Renderer
```

- **実行配置**:
  - **Renderer**:マイク取得・音声再生・barge-in 検知(発話中にユーザー音声を検知)。
  - **Main**:VAD/終話判定・STT・Claude・自称検知・AivisSpeech連携・サイドカー管理。
- **STT/VAD/Turn**:`onnxruntime-node`(task_15で同梱済)を再利用。STT＋VAD は **sherpa-onnx(Apache・prebuilt win-x64)** を第一候補(Whisper=MITモデル)。Smart Turn v3.2(BSD)は既存onnxruntimeで。
  - 留意:sherpa-onnx は自前onnxruntimeを持つ→既存onnxruntime-nodeと**重複**の可能性。Phase Bのスパイクで「sherpa一本」vs「onnxruntime-node再利用＋個別モデル」を実測比較して確定。
- **不要なもの**:ストリーミングSTTモデル(VAD区切り＋非ストリーミングWhisperで回避)。

---

## 2. C1:Conversation Layer ストリーミング再設計

### 現状の契約(衝突点)
`chat()` は `ConversationResponse={type,message,emotion?}` を**完成JSONからパース**(`response-parser.ts`)。素直にstreamすると半端JSONで文単位TTSに渡せない。

### 新契約:「制御ヘッダ ＋ 平文本文 ＋ 任意コマンドトレーラ」
モデルには次の**ストリーム可能な書式**を出力させる(prompt-builder で指示):

```
⟦emotion:joy⟧                      ← 1行目: 感情(表情/スタイルを先に決める)。許可外/欠落→neutral
本文の喋り言葉がここに流れる。文ごとにTTSへ。   ← 本文(プレーンテキスト・stream)
⟦os_command:{"action":"open_browser","args":{...}}⟧   ← 任意: OS操作が要る時だけ末尾に
```

- **ストリーミングパーサ**(状態機械):`header → body → trailer`。
  - header を見たら emotion を確定→表情/スタイルへ。
  - body を受信しつつ**文境界**(`。！？\n`等)で切り出し→ C2ゲート→ TTSキュー。
  - trailer を検知したら本文終了。`os_command` を**喋り終わり後に実行**(現状の実行タイミングと整合)。
- **プロンプトキャッシュ(task_14)不変**:入力プレフィックスは変えない(出力書式だけ変更)。検証済=`beta.promptCaching.messages` は `stream:true`/`.stream()` 対応。
- **非音声の現行JSON経路**:当面は音声経路を別系統で追加し、安定後に統一を検討(後方互換)。

---

## 3. C2:4層防御 × ストリーミング(文単位ゲート)

- 本文を**文バッファ**に貯め、**文境界ごとに `detectAiSelfReference(sentence, neverCallsSelf)`** を実行(軽量ローカル正規表現)。
  - クリーン→TTSキューへ。
  - 検知→**それ以降の発話を止める**＋既存の強化プロンプト再生成へ。
- **既知の制限**:既に**発話済みの文は取り消せない**。ただし自称はまれ＆通常**冒頭付近**に出るため、初手の文を**発話前**に捕捉でき実害は小。吹き出しテキストは訂正後を表示。設計上の割り切りとして記録。

---

## 4. AivisSpeech 連携(`TtsEngine` ＋ HTTPクライアント ＋ サイドカー)

### 4.1 インターフェース(§4.4 疎結合)
```ts
export interface TtsEngine {
  speak(text: string, opts: TtsOptions): Promise<AudioBytes>; // 文単位・WAV/PCM
  listStyles(): Promise<TtsStyle[]>;                          // /speakers 相当
}
export interface TtsOptions {
  styleId: number;            // 感情スタイル(emotion→styleId)
  speedScale?: number;        // 話速
  intonationScale?: number;   // 抑揚(スタイル感情の強さ)
  tempoDynamicsScale?: number;// 緩急
  volumeScale?: number;
  // pitchScale は使わない(AivisSpeechで音質劣化)
}
```
- 実装 `AivisSpeechTtsEngine`:`POST /audio_query?text&speaker=styleId` → クエリ書換 → `POST /synthesis?speaker=styleId` → WAV。baseURL(localhost:10101)は設定値。
- VOICEVOXと**同一API**なので将来VOICEVOX差し替えも同実装で吸収。

### 4.2 emotion→style/params マッピング(§4.5 外出し)
- 新ファイル **`characters/{id}/voice.json`**:emotion ラベル → styleId ＋ パラメータ既定。
```jsonc
{
  "engine": "aivisspeech",
  "baseUrl": "http://127.0.0.1:10101",
  "model": "tsukuyomi",              // 採用AIVM(クリーン)
  "styles": {
    "neutral":     { "styleId": 0, "intonationScale": 1.0, "speedScale": 1.0 },
    "joy":         { "styleId": 1, "intonationScale": 1.2 },
    "anger":       { "styleId": 2, "intonationScale": 1.3 },   // ツン
    "sorrow":      { "styleId": 3, "intonationScale": 1.1 },
    "embarrassed": { "styleId": 4 },                            // デレ
    "surprise":    { "styleId": 0 }                             // 当面neutral流用
  }
}
```
- styleId はモデルの `/speakers` から取得した実値を後で確定(Phase A)。

### 4.3 サイドカー管理(初回DL→子プロセス)
- 初回起動時:AivisSpeech Engine(＋つくよみAIVM)を**自動DL**→ `child_process.spawn`(**shell:false**・固定パス・引数配列=§7.2準拠)で起動 → `/version` 等で**ヘルスチェック**→ 準備完了で会話可。
- アプリ終了時に子プロセスを確実に停止(§7 終了フロー)。
- 配置:エンジン/モデルは **`data/voice/`**(ポータブルユーザーデータ)or `%APPDATA%`。§2に追記。
- **DLは外部通信だがClaude以外**→ §4.2/§7.1 の例外として**明示承認が必要**(エンジン取得のみ・音声データは送らない)。

---

## 5. STT / VAD / ターンテイキング

- **VAD**:Silero(rendererの`@ricky0123/vad-web` or sherpaのVAD)。発話区間を切り出し。
- **STT**:Whisper(MIT・small以上で日本語精度)を sherpa-onnx で実行。確定発話→既存 `sendMessage` 経路へ。
- **Smart Turn v3.2**(BSD・8MB ONNX):無音VADの上に**セマンティック終話**を上乗せ(v1.1)。既存onnxruntime-nodeで。
- **barge-in**:再生/生成中にユーザー発話を検知→ストリーム中断＋再生停止。
- **モデルDL**:Whisper(~466MB等)は初回DL(コア<100MB維持)。

---

## 6. 音声IPC契約(§4拡張)

`EneAPI` に追加(設計のみ・命名は実装で確定):
```ts
startVoice(): Promise<void>;                 // 聴取開始
stopVoice(): Promise<void>;
onTranscript(cb:(text:string)=>void): void;  // main→renderer 確定文字起こし
onSpeakChunk(cb:(buf:ArrayBuffer)=>void):void; // 合成音声チャンク(再生)
sendAudioFrame(pcm:ArrayBuffer): void;       // renderer→main マイクPCM
onBargein(cb:()=>void): void;
```

---

## 7. 声モデル(つくよみちゃんAIVM)— 非コード/ライセンス

- つくよみちゃん Style-Bert-VITS2 モデル→**AIVM変換**→サイドカーのモデルDLに同梱。
- **要確認(Phase A)**:当該つくよみモデルの**アプリ配布時の条件**(コーパスは商用/再配布OK・クレジット要否)。クレジット表記欄を用意。
- 将来:**自作AIVM**(つくよみコーパス等の寛容な種を学習)で魚川トリミ専用声へ差し替え。

---

## 8. 承認が必要な項目(§14)

| 区分 | 内容 | 必要フェーズ |
|---|---|---|
| **新規ライブラリ(§1.2)** | `sherpa-onnx`(Apache・STT/VAD)。※VAD renderer採用時 `@ricky0123/vad-web`(任意) | **Phase B**(STT)。**Phase Aは新規npm不要** |
| **新リソース/ディレクトリ(§2)** | `data/voice/`(エンジン・音声モデル)、`characters/{id}/voice.json` | Phase A |
| **外部通信の例外(§4.2/§7.1)** | サイドカーengine/モデルの**初回DL**(Claude以外への通信)。音声データは送らない | Phase A |
| **OS操作(§7.2)** | サイドカーの `spawn`(shell:false・固定バイナリ・引数配列)。ホワイトリスト思想に沿う | Phase A |
| **設計書修正(§14)** | §1.2/§2/§3.4(ストリーミング応答型)/§4(音声IPC)/§11.1 の更新 | 承認後マージ |

> **重要**:**Phase A(出力TTSで"声が出る")は新規npmライブラリ無し**で着手可能(AivisSpeechはHTTPサイドカー＋自前クライアント、ストリーミングは既存SDK)。承認が要るのは主に**①サイドカーの初回DL(外部通信例外)②resource配置③設計書更新**。`sherpa-onnx`(STT)の承認は**Phase B**で改めて。

---

## 9. 実装順(task_17 フェーズに対応)

1. **Phase A**:`TtsEngine`＋`AivisSpeechTtsEngine`＋`voice.json`／サイドカー管理(DL・spawn・ヘルスチェック)／C1ストリーミング(本文stream→文分割→TTSキュー)／C2文単位ゲート／(task_13後)振幅リップシンク。→ **"声が出る"を達成**。
2. **Phase B**:マイク取得／sherpa-onnx STT＋Silero VAD／確定文字起こし→会話。
3. **Phase C**:Smart Turn v3.2／barge-in／全二重状態機械。
4. **Phase D**:声の調整・確定(人間判定)／レイテンシ実測／受入。

# 05. アーキテクチャ対応表 — 体(フォルダ)と魂(docs)

> **位置づけ**:コードのトップレベル構成(=体)と、哲学が定める「四つのあり方」(=魂)の
> 対応を一枚で示す案内図。ディレクトリ構成の SSOT は `03_design.md` §2、思想の正本は
> `00_philosophy.md`(§1.3 四つのあり方＋関係)。
> 本書は両者の**橋**であり、新しい正解を定義しない(矛盾したら §2 と哲学が優先)。

---

## 0. 原則 — 体はフォルダ、魂は docs

- **`src/` 直下はドメイン名詞**(character / knowledge / memory / conversation / voice)
  +**土台**(app / shared)。トップレベルが「何のアプリか」を叫ぶ(Screaming Architecture)。
  `engine` / `shell` / `core` のようなフレームワーク語をトップに置かない。
- **思想の軸(あり方)はフォルダにしない**。あり方とフォルダの対応は本書(docs)が持つ。
  軸でフォルダを切ると、同じ器官(例:memory)が複数の軸に跨って断裂するため。
- **関係(目的)はどのフォルダにも無い**(§2)。

## 1. 対応表 — あり方 × 目玉機能 × ソース

| あり方(魂) | 担う質 | 目玉機能 | ソース(体) | キャラ資産(`ene/`) |
|---|---|---|---|---|
| **① 来歴・状態・個性を持つ** | 個性 | 人格システムプロンプト・誕生日・最小状態・人生記憶 canon のロード | `src/character/` | identity / background / fewshot / life-memory / current-state .json |
| **② 限られた知識を持つ** | 有限さ | Knowledge Router=役の外は「知らない」(完全ローカル判別・0往復) | `src/knowledge/` | knowledge_domains.json |
| **③ 人間のように記憶する** | 有限さ(忘却・心) | 想起(語彙+entity+ベクトル RRF)・非破壊更新・忘却(§11.6)・**心=記憶から導出する想起バイアス** | `src/memory/` | (ユーザ記憶は `data/memory/{id}/`・canon は ene/life-memory.json) |
| **④ その人の声と語り口で話す** | 個性の発露 | 言葉=Claude 会話(4層防御・few-shot)/ 声=TTS・STT・VAD・相槌・思考フィラー・うなずき | `src/conversation/`・`src/voice/` | voice.json・backchannels.json |
| (土台) | — | デスクトップに棲む器(Electron 配線・UI・OS統合)/ 共有基盤(型・ユーティリティ) | `src/app/`・`src/shared/` | スプライト・animation.json・vrm.json・torimi.vrm |

注:
- **忘却と心は ③(有限さ)に属する**。`04_positioning.md` §3「内面の三点支持」
  (摩擦=ツンデレ / 有限=忘れる長期記憶 / 追憶=中立でない想起)とも一致。
- 立ち絵/VRM の**描画実装**は土台(`src/app/renderer/`)に居るが、emotion→表情・フレームなどの
  **キャラ依存値は必ず `ene/*.json` に外出し**する(CLAUDE.md §4.5。コードに個性を埋めない)。
- キャラ資産のロード機構は各ドメインに属する(例:voice.json → `src/voice/voice-loader.ts`、
  vrm.json / animation.json → `src/character/`)。

## 2. 関係(目的)はフォルダに無い

哲学の目的=**唯一無二の関係**は、①〜④の“誰か”とユーザの時間が絡まり合って**創発する結果**であり、
対応する器官(フォルダ)を持たない。`relationship/` を作らないのは意図的である:
関係はレバー(調整つまみ)ではなく、保存される好感度・感情スカラーも持たない(CLAUDE.md §5.3)。
設計が手を入れてよいのは①〜④と記憶の質まで——関係そのものは時間が立ち上げる。

## 3. 1ターンの流れ図 — 体の中を魂が通る道

```
ユーザ入力(テキスト / 声)
  │ 声の場合: app/renderer(マイク) → app/main(vad-runtime)
  │           → voice/vad-segmenter(区間検出・barge-in) → voice/stt-transcriber(STT)
  ▼
app/main ipc.ts(オーケストレーション・土台)
  ├─ memory/     : 想起(retriever・recall-pool)＋心の色づけ(mood)   … あり方③
  ├─ knowledge/  : ローカル判別 classifyTopicLocal(役の境界)         … あり方②
  └─ character/  : CharacterContext(人格・few-shot・誕生日)          … あり方①
  ▼
conversation/ : prompt-builder → client(Claude API)→ response-parser(4層防御)
                                                                        … あり方④(言葉)
  ▼
voice/        : 文単位分割 → ルビ解決 → TTS 合成(voice-chat)         … あり方④(声)
  ▼
app/renderer  : 吹き出し・立ち絵/VRM・口パク・逐次再生(土台)
  ▼
memory/       : 会話から記憶抽出(extractor・scheduler)→ episodic へ蓄積 … あり方③
                 =関係(目的)が創発する土壌
```

## 4. 依存の向き(疎結合・CLAUDE.md §4.4)

- **ドメイン(character / knowledge / memory / conversation / voice)は `app/` に依存しない**。
  組み立て(配線)は `app/main` が一方向に行う。
- ドメイン間の通信は `src/shared/types/` の型契約を介す。
- `memory/` は Claude を直接知らない(`LlmComplete` を DI・差し替え可能)。
- Electron API に触れるのは土台のみ(`app/` と、Node 専用基盤の `shared/node/`)。
  `shared/` 直下はプロセス非依存の純粋ユーティリティ。

---

*体(フォルダ)は具体名詞で増改築し、魂(あり方と目的)は docs で守る。*
*新しい機能がどのフォルダに住むか迷ったら、§1 の対応表で「どのあり方に奉仕するか」を先に問うこと。*

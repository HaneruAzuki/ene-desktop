# docs/archive — 経緯ドキュメント(現行ではない)

このフォルダは、**役割を終えた・本体へ吸収済みの作業文書**を保管する。
内容は実装当時の判断根拠として価値があるため**削除せず残す**が、
**現行の真実の源(SSOT)ではない**。現行を参照するときは下記の「現行の所在」を見ること。

> 迷ったら:設計の正解は `docs/03_design.md`、目的は `docs/01_vision.md`、
> 規約は `CLAUDE.md`。本フォルダは過去の経緯のみ。

---

## 収録物と現行の所在

| アーカイブ文書 | 何だったか | 現行の真実の源 |
|---|---|---|
| `design-revision-memory-v2.md` | 記憶データモデル v2 の改訂たたき台 | `03_design.md` §3.3 / §5.2(マージ済み) |
| `design-revision-character-heart.md` | 単一固定キャラ・人生記憶・心 の設計詳細たたき台 | `03_design.md` §3.1 / §3.3 / §5(マージ済み) |
| `design-revision-voice.md` | 双方向ローカル音声(task_17)の Phase 0 設計案 | `03_design.md` §1.2 / §2 / §3.4 / §4.2、`02_requirements.md` §2.14。**⚠️ 本書 Phase 0 案(sherpa-onnx・renderer VAD 等)は実装で不採用**。確定は正本側(N-17-8/9/10/11) |
| `character-life-memory-draft.md` | 人生記憶 canon の本文ドラフト(約41記憶) | `characters/ene/life-memory.json`(JSON 化済み)。内容計画は `docs/character-life-memory-canon-plan.md` |
| `design-revision-backchannel-prosody-lv2.md` | 相槌の韻律トーン判定(Lv2/Lv2b・surprise 打ち分け＋自己キャリブレーション＋永続化) | **撤去済み(2026-06-10)**。語彙を continuer に統一したため死蔵化し撤去。現行は `backchannel-engine.ts` のタイミング判定のみ。経緯は `implementation-notes.md` N-18-x |

## 移動の経緯

2026-06 のドキュメント整理で、これらを `docs/` 直下から本フォルダへ移した。
これにより `docs/` 直下は現行の正本(`00`〜`03`・別添A・`implementation-notes`・
`optimization-backlog`・`character-life-memory-canon-plan`)のみになり、
「どれが今の正解か」が一目で分かるようにした。

各実装判断の記録は `docs/implementation-notes.md`(N-15-x / N-16-x / N-17-x)に残る。

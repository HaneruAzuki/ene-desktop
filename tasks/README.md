# ENE Desktop Agent 実装タスク一覧

## 概要

本ディレクトリには、ENE Desktop Agent MVP の実装タスク(task_00〜12)を13個のファイルに
分割して格納しています。MVP 完成後の新機能タスクは末尾「MVP 0.2 以降のタスク」を参照。各タスクは Claude Code が**1〜数日で完了する粒度**で
設計されており、上から順に実装することで MVP が完成します。

## タスク一覧

| # | ファイル名 | レイヤー / 役割 | 主な依存 |
|---|-----------|---------------|---------|
| 00 | [task_00_initial_setup.md](task_00_initial_setup.md) | 初期セットアップ・リポジトリ作成 | なし |
| 01 | [task_01_storage_layer.md](task_01_storage_layer.md) | Storage Layer(パス・暗号化・JSON) | task_00 |
| 02 | [task_02_character_layer.md](task_02_character_layer.md) | Character Layer(プロファイル読込) | task_01 |
| 03 | [task_03_memory_layer.md](task_03_memory_layer.md) | Memory Layer(3層記憶) | task_01, 02 |
| 04 | [task_04_knowledge_router.md](task_04_knowledge_router.md) | Knowledge Router(Haiku判定) | task_01, 02 |
| 05 | [task_05_conversation_layer.md](task_05_conversation_layer.md) | Conversation Layer(Sonnet・AI自称防止) | task_01〜04 |
| 06 | [task_06_os_integration.md](task_06_os_integration.md) | OS Integration(shell API) | task_01, 05 |
| 07 | [task_07_electron_main.md](task_07_electron_main.md) | Electron Main(ウィンドウ・トレイ・IPC) | task_01〜06 |
| 08 | [task_08_renderer_ui.md](task_08_renderer_ui.md) | Renderer UI(React・吹き出し・クリックスルー) | task_07 |
| 09 | [task_09_apikey_dialog.md](task_09_apikey_dialog.md) | APIキー管理ダイアログ | task_01, 07 |
| 10 | [task_10_startup_integration.md](task_10_startup_integration.md) | 起動シーケンス統合 | task_01〜09 |
| 11 | [task_11_build_distribution.md](task_11_build_distribution.md) | ビルド・配布 | task_10 |
| 12 | [task_12_acceptance_tests.md](task_12_acceptance_tests.md) | 受入テスト・手動確認 | task_11 |

## 実装の流れ

```
基盤層         task_00 → task_01
                          ↓
データ・キャラ層       task_02 → task_03
                          ↓
判定・会話層         task_04 → task_05
                          ↓
OS連携             task_06
                          ↓
アプリ基盤・UI    task_07 → task_08 → task_09
                          ↓
統合              task_10
                          ↓
配布              task_11
                          ↓
受入              task_12
```

## 各タスクファイルの構造

すべてのタスクファイルは以下の6項目で統一されています。

1. **目的**:このタスクで達成すべきこと
2. **依存タスク**:このタスクを始める前に完了している必要があるタスク
3. **関連ドキュメント**:設計書・要件・ビジョンの参照箇所
4. **実装範囲**:具体的なファイル・関数・ロジックの指示
5. **受入チェックリスト**:自動チェックと手動チェックを区別
6. **やってはいけないこと**:このタスクで特に注意すべき禁止事項

## 関連ドキュメント

タスクファイルは以下のドキュメントから情報を参照しています。
**実装中に判断に迷ったら、必ず参照元の文書を確認**してください。

- `/CLAUDE.md` — Claude Code 向け開発規約
- `/docs/01_vision.md` — プロダクトの本質・判断基準
- `/docs/02_requirements.md` — 機能要件・非機能要件
- `/docs/03_design.md` — 技術設計(真実の源)
- `/docs/A_character_profile_samples.md` — キャラJSON完全サンプル

## 真実の源(SSOT)マッピング

| 知りたいこと | 参照先 |
|------------|--------|
| 使うライブラリ・バージョン | `docs/03_design.md` §1.2 |
| ディレクトリ構成 | `docs/03_design.md` §2 |
| 機能要件 | `docs/02_requirements.md` §2 |
| データスキーマ・型定義 | `docs/03_design.md` §3, §5 |
| IPC通信プロトコル | `docs/03_design.md` §4 |
| エラーハンドリング方針 | `docs/03_design.md` §6 |
| 起動・終了フロー | `docs/03_design.md` §7 |
| キャラJSON サンプル | `docs/A_character_profile_samples.md` |
| プロダクトの更新運用 | `docs/03_design.md` §11.8 |
| 将来拡張の方針 | `docs/03_design.md` §11 |
| プロダクトの本質 | `docs/01_vision.md` |
| 開発規約・禁止事項 | `CLAUDE.md` |

## MVP 完成の判定

task_12 の手動確認プロトコル(成功基準8)を含むすべての受入基準を満たした時点で
**ENE Desktop Agent MVP が完成**とする。

## MVP 0.2 以降のタスク(post-MVP)

MVP(task_00〜12)完成後の新機能フェーズ。方針・ロードマップは
`docs/00_philosophy.md`(北極星・次元と役割・ステージ別ロードマップ)を参照。

| # | ファイル名 | レイヤー / 役割 | 主な依存 |
|---|-----------|---------------|---------|
| 13 | [task_13_animation.md](task_13_animation.md) | MVP 0.2「存在感」: アニメ基盤(状態機械・PNG差分・emotion表情・考える間・クリック音) | task_07, 08, 10 |
| 14 | [task_14_memory_request_optimization.md](task_14_memory_request_optimization.md) | MVP 0.3「記憶リクエスト最適化」: Tier0/1/2 再構成＋プロンプトキャッシュ＋クリック起点ウォーム | task_05, 08 |
| 15 | [task_15_memory_recall_update.md](task_15_memory_recall_update.md) | MVP 0.3「記憶の会話活用強化」: 想起エンジン(ベクトル＋語彙＋entity ハイブリッド)＋記憶更新(supersede) | task_03, 04, 05 |

> - MVP 0.2「存在感」のコード作業は task_13 に集約(アニメ用の別タスク task_14 は作らない)。
> - task_14 = **MVP 0.3 のコスト最適化**(記憶リクエストの Tier 再構成＋キャッシュ)。
> - task_15 のデータモデルは `docs/design-revision-memory-v2.md`(§3.3/§5.2 改訂案)に定義。
>   想起・更新の**処理**は task_15、**データの持ち方**は当該改訂文書、で分離している。

### 実装着手順(確定: 2026-06)

**task_15 → task_14 → task_13** の順で実装する。

1. **task_15（想起＋更新）を最初に**。Phase A(語彙＋entity＋supersede＋データモデル＋抽出フロー)は
   依存ゼロで即着手可。Phase B(ベクトル)は**埋め込みモデルの承認待ち**(別DL・§1.2更新を伴う)。
2. **task_14（コスト最適化）を次に**。14 は「リクエストに何が載るか」を前提に Tier 境界を設計するため、
   先に 15 で記憶コンテキストの中身・置き場所を固める必要がある(**15を先にしないと14が手戻り**)。
   `MemoryRetriever` の戻り値を 14 が Tier2(現ユーザーターン)へ配置する。
3. **task_13（アニメ）を最後に**。描画レイヤーで 14/15 と技術的に独立。
   ただし **VRoidスプライト作成(手作業・付録B-1)は 15/14 の実装と並行して前倒し**で進め、
   13 のコード着手時に素材が揃っているようにする(手作業を最後に直列させない)。

# ENE Desktop Agent

一生そばにいてくれる、個性を持ったデスクトップの存在(コードネーム: **ENE** / キャラクター名: **魚川トリミ**)。

Windows デスクトップに常駐する透過ウィンドウのAIキャラクターアプリ。
頭脳は Claude(BYO API キー)、記憶・音声・表示はすべてローカルで完結する。

## なぜこの形か(30秒)

**ENE は「誰でもない機械(汎用AI)」ではなく、「ユーザとただ一つの関係を結ぶ“誰か”」を演じる。**
全能力を「ひとりの誰か」を成り立たせる**四つのあり方**——①来歴・状態・個性 ②限られた知識
③人間のような記憶 ④その人の声と語り口——に注ぎ、そこから**唯一無二の関係**が創発する。
速さ・品質は常に最大化し、有限さは“役”に限る。思想の正本は [docs/00_philosophy.md](docs/00_philosophy.md)。

## 設計の地図

`src/` 直下は**ドメイン名詞**(何のアプリかが一目で分かる構成)。各フォルダは哲学の四つのあり方に対応する。
**体(フォルダ)× 魂(哲学)の対応表・1ターンの流れ図・依存の向き**は [docs/05_architecture.md](docs/05_architecture.md) に集約。

```
src/
├── character/      … ① 来歴・状態・個性(人格プロンプト・誕生日・人生記憶ロード)
├── knowledge/      … ② 限られた知識(完全ローカルの話題判別=役の境界)
├── memory/         … ③ 人間のような記憶(想起・忘却・心=記憶からの導出)
├── conversation/   … ④ 語り口=言葉(Claude 会話・4層防御)
├── voice/          … ④ 語り口=声(TTS・STT・VAD・相槌・うなずき)
├── app/            … 土台:Electron の器(main / preload / renderer / os)
└── shared/         … 土台:共有型・ユーティリティ(node/ は Node 専用基盤)

ene/                … 同梱キャラ定義(=characterId。JSON＋立ち絵＋VRM＋声設定)
```

> 関係(目的)はどのフォルダにも無い——①〜④の“誰か”とユーザの時間が絡まって**創発する結果**だから(詳細は 05)。

## ドキュメント

上流(なぜ)から下流(どう作るか)の順。判断に迷ったら上流を優先する。

| ファイル | 内容 |
|---------|------|
| [docs/00_philosophy.md](docs/00_philosophy.md) | 思想の北極星(なぜこの形か・四つのあり方＋関係) |
| [docs/01_vision.md](docs/01_vision.md) | プロダクトの本質・判断基準・ロードマップ |
| [docs/04_positioning.md](docs/04_positioning.md) | 外向き(系譜・うたい文句・配布・収益) |
| [docs/02_requirements.md](docs/02_requirements.md) | 機能要件・非機能要件 |
| [docs/03_design.md](docs/03_design.md) | 技術設計(真実の源)・ディレクトリ構成 §2 |
| [docs/05_architecture.md](docs/05_architecture.md) | 体(フォルダ)× 魂(哲学)の対応・流れ図 |
| [docs/A_character_profile_samples.md](docs/A_character_profile_samples.md) | キャラJSON完全サンプル |
| [CLAUDE.md](CLAUDE.md) | 開発規約・禁止事項 |
| [tasks/README.md](tasks/README.md) | 実装タスク一覧 |

## 開発

前提: Node.js 24 LTS(設計書 §1.2)

```bash
npm ci            # 依存をロックファイル通りに導入(初回は npm install)
npm run dev       # electron-vite で開発起動(透過ウィンドウ表示)
npm run typecheck # tsc による型チェック
npm run lint      # ESLint
npm run test      # Vitest 単体テスト
npm run build            # ビルド(out/ 生成)
npm run package:portable # Windows 向け portable exe を生成(dist/ENE-Desktop-<version>.exe)
```

## 配布(ポータブル exe)

`npm run package:portable` で `dist/ENE-Desktop-<version>.exe` が生成される。
インストール不要で、exe をどこに置いても動作する。初回起動時に API キーを設定する。

- ユーザデータ(記憶・設定・ログ)は **exe と同じディレクトリの `data/`** に生成される(可搬・平文JSON)。
- API キーは暗号化されて **`%APPDATA%/ene-desktop/api-key.enc`** に保存される(マシン固定)。

## 更新方法(設計書 §11.8)

新バージョン配布時、ユーザは exe を差し替えるだけでよい。

1. 新しい `ENE-Desktop-<version>.exe` をダウンロード
2. 既存の exe を新しいものに置き換える(上書き)
3. `data/` ディレクトリはそのまま(記憶・設定が引き継がれる)
4. API キーも再入力不要(`%APPDATA%/ene-desktop/api-key.enc` に保存されているため)
5. アプリを再起動

## ライセンス

UNLICENSED(配布形態は未定)。キャラクター画像等のリソースはライセンスに留意して用意すること。

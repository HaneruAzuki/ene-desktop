# ENE Desktop Agent

一生付き合える、人格を持ったデスクトップの相棒(コードネーム: **ENE**)。

Windows デスクトップに常駐する透過ウィンドウのAIキャラクターアプリ。
詳細なビジョン・要件・設計は `docs/` を参照。

## ドキュメント

| ファイル | 内容 |
|---------|------|
| [docs/01_vision.md](docs/01_vision.md) | プロダクトの本質・判断基準(最優先) |
| [docs/02_requirements.md](docs/02_requirements.md) | 機能要件・非機能要件 |
| [docs/03_design.md](docs/03_design.md) | 技術設計(真実の源) |
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
npm run build     # ビルド(out/ 生成)
npm run package   # electron-builder で Windows 向け exe を生成
```

## ライセンス

UNLICENSED(配布形態は未定)。キャラクター画像等のリソースはライセンスに留意して用意すること。

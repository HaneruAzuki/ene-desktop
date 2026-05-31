# Task 11: ビルドと配布

## 目的

ENE をユーザーが配布できる単一の exe にビルドする。
配布サイズ目標(100MB以下)を満たし、Windows 環境で動作することを確認する。

## 依存タスク

- task_10(起動シーケンス統合完了 — 機能が完全に動く状態)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §1.2(技術スタック)
- 設計書 `docs/03_design.md` §9(ビルドと配布)
- 設計書 `docs/03_design.md` §11.8(プロダクトの更新運用)
- 要件 `docs/02_requirements.md` §3.2(軽量性 NF-SIZE-01)
- CLAUDE.md §2.4(バージョン指定方針)

## 実装範囲

### 1. electron-vite 設定(`electron.vite.config.ts`)

```typescript
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,  // 開発時のみ
      outDir: "out/main",
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
          apiKeyDialog: "src/renderer/api-key-dialog/index.html",
        },
      },
    },
  },
});
```

### 2. electron-builder 設定(`electron-builder.yml`)

設計書 §9.3 に従って実装。

```yaml
appId: com.example.ene-desktop
productName: ENE Desktop
directories:
  output: dist
  buildResources: resources
files:
  - out/**/*
  - characters/**/*
  - "!node_modules/**/*"
  - "!src/**/*"
  - "!tests/**/*"
  - "!docs/**/*"
  - "!tasks/**/*"
asar: true
asarUnpack:
  - characters/**/*    # キャラJSONはユーザーがカスタマイズ可能なので unpack
win:
  target:
    - target: portable
      arch:
        - x64
  icon: resources/icon.ico
  artifactName: "ENE-Desktop-${version}.${ext}"
portable:
  artifactName: "ENE-Desktop-${version}.exe"
  splashImage: null
```

#### 重要な選択

- **`portable` ターゲット**を採用(設計書 §3.6 ポータブル方式)
  - インストーラ不要、exe をどこに置いても動く
  - `data/` は exe と同じディレクトリに作成される
- **`asar: true`** でコードを単一アーカイブにまとめる
- **`characters/`** は `asarUnpack` で展開状態を維持(ユーザーが将来追加可能に)

### 3. リソースの準備

#### アプリアイコン(`resources/icon.ico`)

- 256×256, 128×128, 64×64, 32×32, 16×16 を含む ico ファイル
- キャラのフェイスアイコン推奨

#### タスクトレイアイコン(`resources/tray-icon.png`)

- 16×16 または 32×32 の PNG
- 透過対応
- Windows のトレイで見やすい色合い

#### インストーラアイコン(`resources/installer-icon.ico`)

- portable ターゲットでは不要だが、将来の NSIS ターゲット用に準備

### 4. package.json スクリプト確認

task_00 で定義済みのスクリプトを最終確認:

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "package": "electron-vite build && electron-builder",
    "package:portable": "electron-vite build && electron-builder --win portable",
    "test": "vitest run",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write ."
  }
}
```

### 5. 配布サイズの最適化

設計書 §9.4 / 要件 NF-SIZE-01(100MB以下)を満たすための対策:

#### 削除対象

- `devDependencies` を含めない(electron-builder が自動的に dependencies のみ使う)
- ソースマップを本番ビルドでは除外する場合は `sourcemap: false`
- 不要なロケールファイル(electron-builder の `electronLanguages` で制限可能)

#### electron-builder.yml への追記

```yaml
electronLanguages:
  - ja
  - en-US
```

#### 確認方法

```bash
ls -lh dist/
# ENE-Desktop-x.x.x.exe のサイズが 100MB 以下であること
```

### 6. ビルドの検証

#### ビルド手順

```bash
# 開発時の動作確認
npm run dev

# 本番ビルド(コード生成のみ)
npm run build

# 配布用 exe 生成
npm run package:portable

# 出力確認
ls -lh dist/
```

#### 動作確認手順

1. `dist/ENE-Desktop-x.x.x.exe` を別のディレクトリにコピー
2. ダブルクリックで起動
3. 初回起動 → APIキーダイアログ表示
4. APIキー設定 → ENE 起動
5. exe と同じディレクトリに `data/` が作成されることを確認
6. `%APPDATA%/ene-desktop/api-key.enc` が作成されることを確認

### 7. 更新運用のドキュメント整備

設計書 §11.8 に従い、`README.md`(プロジェクトルート)に更新方法を記載。

```markdown
# 更新方法

新バージョンの配布時:
1. 新しい ENE-Desktop-x.x.x.exe をダウンロード
2. 既存の exe を新しいものに置き換える(上書き)
3. `data/` ディレクトリはそのまま(記憶・設定が引き継がれます)
4. APIキーも再入力不要(`%APPDATA%/ene-desktop/api-key.enc` に保存されているため)
5. アプリを再起動
```

### 8. バージョン管理

`package.json` の `version` を semantic versioning で管理。
MVP の初回リリースは `0.1.0` を推奨。

```json
{
  "version": "0.1.0"
}
```

### 9. リリースノート(任意)

`CHANGELOG.md` を作成(将来の更新運用のため):

```markdown
# ENE Desktop Changelog

## [0.1.0] - YYYY-MM-DD
### Added
- 初回MVP リリース
- キャラクター ENE
- 3層記憶システム
- Claude Sonnet による会話
- OS操作(メモ帳/ブラウザ/フォルダ)
- 透過ウィンドウ・タスクトレイ
```

## 受入チェックリスト

### 自動チェック

- [ ] `npm run build` がエラーなく完了する
- [ ] `npm run package:portable` がエラーなく完了する
- [ ] `dist/ENE-Desktop-x.x.x.exe` が生成される
- [ ] exe ファイルサイズが 100MB 以下である
- [ ] `npm run typecheck` が通る
- [ ] `npm run lint` が通る
- [ ] `npm run test` が通る

### 手動チェック

- [ ] dist の exe を別のディレクトリにコピーして実行できる
- [ ] 初回起動でAPIキーダイアログが表示される
- [ ] 起動後、exe と同じディレクトリに `data/` が作成される
- [ ] %APPDATA%/ene-desktop/api-key.enc が作成される
- [ ] アプリを終了し、exe を別ディレクトリに移動して起動した場合に、APIキーは引き継がれない(マシン固定・別ディレクトリ扱い)が記憶は残る
- [ ] 同じディレクトリでexeを上書きして再起動すると、記憶もAPIキーも引き継がれる
- [ ] タスクマネージャでメモリ使用量を確認:200MB 以下
- [ ] 起動から表示までの時間が 3秒以内
- [ ] 常駐時の CPU 使用率が 3% 以下(アイドル時)
- [ ] Windows 10 と Windows 11 の両方で動作確認

## やってはいけないこと

- ❌ `devDependencies` を `dependencies` に移動して配布する(サイズ増加)
- ❌ `data/` を配布物に含める(ユーザーデータは実行時生成)
- ❌ `docs/`、`tasks/` を配布物に含める(設計書は配布不要)
- ❌ `node_modules` を配布物にコピー(electron-builder が処理)
- ❌ Anthropic API キーをハードコードして配布(致命的なセキュリティリスク)
- ❌ プレースホルダーキャラ画像のまま配布(正式画像に差し替え)
- ❌ NSIS インストーラ等を MVP で導入(portable で十分)
- ❌ 自動更新機構(`electron-updater`)を MVP で実装(設計書 §11.8)
- ❌ 100MB 超過したまま配布(NF-SIZE-01 違反)

## 完了の定義

`npm run package:portable` で生成された exe が単独で実行可能。
ユーザーが exe を任意のディレクトリにコピーして実行できる。
ファイルサイズが 100MB 以下、常駐 CPU 3% 以下、メモリ 200MB 以下。

次のタスク(task_12)で受入テストと手動確認プロトコルを実施する準備が整う。

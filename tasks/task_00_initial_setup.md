# Task 00: 初期セットアップ

## 目的

ENE プロジェクトのリポジトリ構造を初期化し、ビルド可能な最小構成
(空の Electron アプリが起動する状態)を作る。以降のすべてのタスクの土台となる。

## 依存タスク

なし(最初のタスク)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §1.2(技術スタック)
- 設計書 `docs/03_design.md` §2(ディレクトリ構成)
- CLAUDE.md §2(技術スタック規約)
- CLAUDE.md §3(ディレクトリ構成規約)
- CLAUDE.md §10(Git運用規約)

## 実装範囲

### 1. ドキュメントの配置

既存の5つのドキュメントを正しい場所に配置する。

```
プロジェクトルート/
├── CLAUDE.md                            ← ルート直下
└── docs/
    ├── 01_vision.md
    ├── 02_requirements.md
    ├── 03_design.md
    └── A_character_profile_samples.md
```

### 2. リポジトリ初期化

```bash
git init
```

`.gitignore` を作成(CLAUDE.md §10.2 参照):
- `node_modules/`
- `dist/`
- `out/`
- `data/`(ユーザーの実行時データ。リポジトリに含めない)
- `.env`、`.env.local`
- `*.log`
- OS固有(`.DS_Store`、`Thumbs.db`)
- IDE設定(`.vscode/`、`.idea/`)

`package-lock.json` は `.gitignore` に**含めない**(CLAUDE.md §2.4 参照)。

### 3. package.json 作成

設計書 §1.2 の技術スタックに従って `package.json` を作成。

**dependencies(同梱ライブラリ)**:
- `electron` `^30.x`
- `react` `^18.x`
- `react-dom` `^18.x`
- `@anthropic-ai/sdk` `^0.30.x`
- `electron-log` `^5.x`

**devDependencies(開発時のみ)**:
- `typescript` `^5.x`
- `@types/react`、`@types/react-dom`、`@types/node`
- `vite` `^5.x`
- `electron-vite` `^2.x`
- `electron-builder` `^24.x`
- `vitest` `^1.x`
- `eslint` `^8.x`
- `@typescript-eslint/eslint-plugin`、`@typescript-eslint/parser` `^7.x`
- `prettier` `^3.x`

**scripts**:
- `dev`: `electron-vite dev`
- `build`: `electron-vite build`
- `package`: `electron-builder`
- `test`: `vitest run`
- `lint`: `eslint . --ext .ts,.tsx`
- `typecheck`: `tsc --noEmit`
- `format`: `prettier --write .`

### 4. TypeScript設定

`tsconfig.json` を作成。**strict mode 必須**(CLAUDE.md §8.1)。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/**/*"]
}
```

### 5. ESLint + Prettier 設定

`.eslintrc.json` と `.prettierrc.json` を作成。
TypeScript strict ruleset を有効化する。

### 6. ディレクトリ構造の作成

設計書 §2 に従って空のディレクトリ構造を作成する。
**`data/` と `characters-custom/` は実行時生成なので、初期は不要**。

```
src/
├── main/
│   ├── index.ts                  ← エントリポイント(最小実装)
│   ├── window.ts
│   ├── tray.ts
│   ├── ipc.ts
│   └── lifecycle.ts
├── preload/
│   └── index.ts
├── renderer/
│   ├── index.html
│   ├── main.tsx                  ← React エントリ
│   ├── App.tsx                   ← トップコンポーネント(最小実装)
│   └── components/
├── shared/
│   ├── types/
│   ├── datetime.ts               ← (本タスクではスタブのみ)
│   └── logger.ts                 ← (本タスクではスタブのみ)
├── character/                    ← (空ディレクトリ)
├── memory/                       ← (空ディレクトリ)
├── router/                       ← (空ディレクトリ)
├── conversation/                 ← (空ディレクトリ)
├── os/                           ← (空ディレクトリ)
└── storage/                      ← (空ディレクトリ)

characters/
└── ene/
    ├── identity.json             ← A_character_profile_samples.md §A.1 からコピー
    ├── background.json           ← §A.2 からコピー
    ├── knowledge_domains.json    ← §A.3 からコピー
    ├── fewshot.json              ← §A.4 からコピー
    └── portrait.png              ← プレースホルダー画像(240×320 PNG)

resources/
├── icon.ico                      ← プレースホルダー
├── tray-icon.png                 ← プレースホルダー(16〜32px)
└── installer-icon.ico            ← プレースホルダー

tests/
├── unit/
└── acceptance/
```

### 7. 最小限の動作確認用 main process

`src/main/index.ts` に、空の透過ウィンドウを表示するだけの最小実装を書く。

```typescript
// 透過設定のみ確認できる最小構成
// - frame: false, transparent: true, alwaysOnTop: true
// - 大きさ 240x320
// - 中身は空(白いキャンバスでよい)
```

この時点では Renderer も最小実装(空の React コンポーネント)で良い。

### 8. ENE Character Profile の配置

別添 A(`docs/A_character_profile_samples.md`)から
4つの JSON ファイルをコピーして `/characters/ene/` に配置する。

`portrait.png` は本タスクでは**プレースホルダー画像**(透明 PNG)で良い。
正式画像は別途用意する。

## 受入チェックリスト

### 自動チェック

- [ ] `npm install` がエラーなく完了する
- [ ] `npm run typecheck` が通る
- [ ] `npm run lint` が通る
- [ ] `npm run dev` で Electron アプリが起動する
- [ ] 起動時に透過ウィンドウが画面に表示される(中身は空でよい)
- [ ] `package-lock.json` がコミットされている
- [ ] `data/` が `.gitignore` に含まれている
- [ ] `node_modules/` が `.gitignore` に含まれている

### 手動チェック

- [ ] 起動した透過ウィンドウの背景が透明である(下のデスクトップが見える)
- [ ] フレーム(タイトルバー)が表示されていない
- [ ] ウィンドウサイズが約 240×320 ピクセルである
- [ ] `characters/ene/` 配下に4つの JSON ファイルが存在し、JSON として valid

## やってはいけないこと

- ❌ `latest` バージョン指定(CLAUDE.md §2.4)
- ❌ `package-lock.json` を `.gitignore` に追加する
- ❌ 設計書 §1.2 に記載のないライブラリを追加する
- ❌ TypeScript strict モードを無効化する
- ❌ ビジネスロジックの実装(本タスクは初期セットアップのみ)
- ❌ `data/` ディレクトリを Git に含める

## 完了の定義

`npm run dev` で空の透過ウィンドウが起動し、`npm run typecheck` `npm run lint` が
すべて通り、リポジトリが Git にコミットされた状態。

次のタスク(task_01)で Storage Layer を実装する準備が整う。

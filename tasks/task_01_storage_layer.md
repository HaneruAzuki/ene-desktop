# Task 01: Storage Layer 実装

## 目的

ファイルパスの統一管理、APIキーの暗号化保存・復号、平文JSONファイルの
読み書きを担当する Storage Layer を実装する。他の全レイヤーが依存する基盤。

## 依存タスク

- task_00(初期セットアップ完了)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §3.6(Storage Layer)
- 設計書 `docs/03_design.md` §5.3(ファイル命名規則)
- 設計書 `docs/03_design.md` §5.4(active-character.json)
- 設計書 `docs/03_design.md` §5.5(キャラ別記憶構造)
- 設計書 `docs/03_design.md` §5.6(日時表現の規約)
- CLAUDE.md §6(データ管理規約)

## 実装範囲

### 1. 日時ユーティリティ(`src/shared/datetime.ts`)

設計書 §5.6 に従い、ローカルタイム + TZオフセットの日時ユーティリティを実装。

```typescript
// 必須関数
export function nowLocalIso(): string;
// 例: "2026-05-10T17:30:00+09:00"

export function nowLocalIsoForFilename(): string;
// 例: "2026-05-10T17-30-00"(":" を "-" に置換、TZ省略)

export function todayLocalYmd(): { year: number; month: number; day: number };
// 誕生日判定用
```

**重要**:`new Date().toISOString()` の使用は禁止(UTC を返すため)。

### 2. ロガー(`src/shared/logger.ts`)

`electron-log` をラップした薄いロガーを提供。

```typescript
export const log = {
  error: (msg: string, meta?: object) => void,
  warn: (msg: string, meta?: object) => void,
  info: (msg: string, meta?: object) => void,
  debug: (msg: string, meta?: object) => void,
};
```

**重要**(CLAUDE.md §12、設計書 §6.2):
- `meta` には会話内容・プロンプト全文・記憶コンテキスト等の個人情報を含めない
- 含めるのは「Router 判定結果のドメイン名」「API応答時間」等のメタ情報のみ

### 3. パス管理(`src/storage/paths.ts`)

設計書 §3.6 §5.5 に従って実装。

```typescript
// ポータブルデータ(exeと同じディレクトリの data/)
export function getPortableDataDir(): string;

// active-character の characterId を参照して動的にパスを返す
export function getMemoryDir(): string;
export function getEpisodicDir(year: number, category: string): string;
export function getSemanticPath(): string;
export function getShortTermPath(): string;

// キャラ運用状態(常に固定パス)
export function getActiveCharacterPath(): string;

// その他のポータブルデータ
export function getLogsDir(): string;
export function getWindowPositionPath(): string;

// マシン固定データ
export function getMachineDataDir(): string;
export function getApiKeyPath(): string;
```

#### 開発時と本番時のパス解決(設計書 §3.6)

```typescript
function getPortableDataDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(process.execPath), "data");
  } else {
    return path.join(process.cwd(), "data");
  }
}
```

`getMachineDataDir()` は `app.getPath("userData")` を使う(環境問わず)。

### 4. 暗号化(`src/storage/encryption.ts`)

Electron `safeStorage` を使った APIキー暗号化。

```typescript
export async function encryptAndSaveApiKey(plaintext: string): Promise<void>;
export async function loadAndDecryptApiKey(): Promise<string | null>;
export async function isApiKeyAvailable(): Promise<boolean>;
```

**重要**:
- 暗号化対象は **APIキーのみ**(設計書 §3.6、CLAUDE.md §6.3)
- 保存先は `%APPDATA%/ene-desktop/api-key.enc`
- 読込失敗時は null を返す(エラーを throw しない)

### 5. JSON 操作(`src/storage/json-store.ts`)

平文 JSON の汎用読み書き。

```typescript
export async function readJson<T>(path: string): Promise<T | null>;
// ファイルが存在しない場合は null を返す
// JSON パースエラーは throw する

export async function writeJson<T>(path: string, data: T): Promise<void>;
// ディレクトリが存在しない場合は再帰的に作成する
// 既存ファイルは上書き(アトミックに:tmpファイル → rename)

export async function listJsonFiles(dir: string): Promise<string[]>;
// ディレクトリが存在しない場合は空配列を返す
// 拡張子が .json のファイル名のみを返す
```

**重要**:
- すべて `fs.promises` を使う(同期I/O 禁止・CLAUDE.md §12)
- 書き込みはアトミック(中途半端なファイルを残さない)

### 6. クラウド同期警告ユーティリティ(`src/storage/cloud-warning.ts`)

設計書 §7.1 ステップ4 で使用する。

```typescript
export function isCloudSyncFolder(dataDir: string): boolean;
// dataDir のパスに以下の語が含まれるかチェック:
// "OneDrive", "Dropbox", "Google Drive", "iCloud", "Box Sync"
// 含まれる場合 true
```

### 7. 多重起動防止(`src/main/single-instance.ts`)

設計書 §7.1 ステップ1 で使用するため、Storage Layer の一部として実装。

```typescript
export function acquireSingleInstanceLock(): boolean;
// app.requestSingleInstanceLock() のラッパー
// 取得失敗時は false を返す(呼出元で app.quit() する)
```

## 受入チェックリスト

### 自動チェック

- [ ] `nowLocalIso()` がローカルタイム+offset形式を返す(UTC ではない)
- [ ] `nowLocalIsoForFilename()` がコロンを `-` に置換した文字列を返す
- [ ] `getPortableDataDir()` が開発時/本番時で異なるパスを返す
- [ ] `getMemoryDir()` が `active-character.json` の `characterId` を参照して動的にパスを返す
- [ ] `encryptAndSaveApiKey()` で保存したキーを `loadAndDecryptApiKey()` で復号できる
- [ ] `readJson()` が存在しないファイルで null を返す
- [ ] `writeJson()` がディレクトリを再帰的に作成する
- [ ] `writeJson()` がアトミックに書き込む(中断時に破損しない)
- [ ] `listJsonFiles()` が存在しないディレクトリで空配列を返す
- [ ] `isCloudSyncFolder()` が OneDrive/Dropbox 等を検知する
- [ ] `acquireSingleInstanceLock()` が2つ目のプロセスで false を返す
- [ ] Vitest による単体テストが通る
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] 開発時に `data/` ディレクトリがプロジェクトルートに作成される
- [ ] 本番ビルド時に `data/` ディレクトリが exe と同じディレクトリに作成される
- [ ] APIキーファイル(`api-key.enc`)が `%APPDATA%/ene-desktop/` に作成される
- [ ] APIキー暗号化ファイルをテキストエディタで開いても内容が読めない(暗号化されている)
- [ ] 平文JSONファイル(memory配下など)はテキストエディタで読める

## やってはいけないこと

- ❌ `new Date().toISOString()` の使用(UTC を返す・設計書 §5.6)
- ❌ 同期I/O(`fs.readFileSync` など・CLAUDE.md §12)
- ❌ APIキー以外の暗号化(CLAUDE.md §6.3)
- ❌ 記憶ファイル・設定ファイルの暗号化
- ❌ ログに会話内容・プロンプト全文・記憶内容を含めること
- ❌ パス操作で `path.join` を使わずに文字列連結
- ❌ Renderer Process でファイルシステムに直接アクセス(全て IPC 経由・設計書 §4.1)
- ❌ `any` 型の安易な使用

## 完了の定義

Storage Layer のすべての関数が動作し、単体テストが通る。
他のレイヤー(Memory、Character、Conversation等)から `import` して使える状態。

次のタスク(task_02)で Character Layer を実装する準備が整う。

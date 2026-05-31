# Task 06: OS Integration Layer 実装

## 目的

Conversation Layer から渡された `OsCommand` を安全に実行する。
ホワイトリスト方式で action と target を厳格に検証し、
Electron `shell` API を使ってシェル経由を避ける。

## 依存タスク

- task_01(Storage Layer 完了 — ユーザーホーム配下チェックで使用)
- task_05(Conversation Layer 完了 — OsCommand 型を使用)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §3.5(OS Integration Layer)
- 要件 `docs/02_requirements.md` §2.10(OS操作)
- CLAUDE.md §7.2(OS操作の制限)

## 実装範囲

### 1. 型定義(`src/shared/types/os.ts`)

```typescript
import type { OsAction, OsCommand } from "./conversation";

export interface OsCommandResult {
  ok: boolean;
  message?: string;  // 実行失敗時のキャラ口調メッセージ(オプション)
  reason?: "invalid_action" | "invalid_target" | "path_traversal"
         | "outside_home" | "non_https" | "exec_error";
}
```

### 2. action ハンドラ(`src/os/actions.ts`)

action ごとの実行関数を定義。

```typescript
import { shell } from "electron";
import { spawn } from "child_process";

export async function openNotepad(): Promise<OsCommandResult>;
// spawn("notepad.exe") を引数なしで実行
// 引数なし固定なので、コマンドラインからファイルを開かれる攻撃を防げる

export async function openBrowser(target: string): Promise<OsCommandResult>;
// target を validateUrl() で検証してから shell.openExternal(target)

export async function openFolder(target: string): Promise<OsCommandResult>;
// target を validatePath() で検証してから shell.openPath(target)
```

### 3. ターゲット検証(`src/os/validators.ts`)

#### URL 検証

```typescript
export function validateUrl(url: string): { ok: boolean; reason?: string } {
  // 1. URL コンストラクタでパース(失敗 → 不正)
  // 2. プロトコルが "http:" または "https:" のみ許可
  //    "javascript:", "file:", "smb:" 等は拒否
  // 3. ホスト名が存在すること
}
```

#### パス検証

```typescript
export function validatePath(targetPath: string): { ok: boolean; reason?: string } {
  // 1. 絶対パスであること(相対パス不可)
  // 2. ユーザーホームディレクトリ配下であること
  //    os.homedir() を使って判定
  // 3. パストラバーサル(".." を含む)を拒否
  //    path.normalize() してから ".." が含まれていないか確認
  // 4. ホームディレクトリ外への path.relative 結果が ".." で始まる場合は拒否
}
```

#### 検証の詳細(設計書 §3.5「セキュリティ考慮」)

| 脅威 | 対策 |
|------|------|
| シェルインジェクション | `shell.openExternal/openPath` を使用(シェル経由しない) |
| 任意コマンド実行 | action は型レベルで3種類に固定(リテラルユニオン) |
| 任意URL誘導 | http/https のみ許可 |
| パストラバーサル | `path.relative` で境界チェック、`..` を拒否 |
| ユーザーホーム外アクセス | `os.homedir()` 配下に限定 |
| notepad.exe 偽装 | 引数なし固定 |

### 4. コマンド実行ディスパッチャ(`src/os/executor.ts`)

```typescript
export async function executeOsCommand(command: OsCommand): Promise<OsCommandResult>;
```

#### 動作仕様

```typescript
async function executeOsCommand(command: OsCommand): Promise<OsCommandResult> {
  switch (command.action) {
    case "open_notepad":
      return openNotepad();

    case "open_browser":
      if (!command.target) {
        return { ok: false, reason: "invalid_target" };
      }
      return openBrowser(command.target);

    case "open_folder":
      if (!command.target) {
        return { ok: false, reason: "invalid_target" };
      }
      return openFolder(command.target);

    default:
      // 型レベルで網羅されているはずだが、安全側のフォールバック
      return { ok: false, reason: "invalid_action" };
  }
}
```

### 5. エラーメッセージ(キャラ口調)

`OsCommandResult.message` には、実行失敗時のキャラ口調メッセージを入れる。
ただし、これは**フォールバック用**であり、通常は Conversation Layer の応答 JSON 内の
`message` を優先表示する(設計書 §3.5「キャラ応答との統合」)。

```typescript
const FALLBACK_MESSAGES: Record<string, string> = {
  invalid_action: "それはできないみたい…",
  invalid_target: "ちょっとそのパス、開けないんだけど…",
  path_traversal: "そんな変なパス指定はできないわよ",
  outside_home: "ホームフォルダの外は開けないわよ。守らなきゃいけないし。",
  non_https: "そのURL、ちょっと開きたくないかな…",
  exec_error: "あれ?開けなかった。なんでだろ…",
};
```

**注意**:これらのメッセージはキャラ非依存(MVP仕様)。
将来的に identity.json から取得する拡張余地あり。

## 受入チェックリスト

### 自動チェック

- [ ] `executeOsCommand({action: "open_notepad"})` がメモ帳を起動する
- [ ] `executeOsCommand({action: "open_browser", target: "https://example.com"})` が成功する
- [ ] `executeOsCommand({action: "open_browser", target: "javascript:alert(1)"})` が拒否される
- [ ] `executeOsCommand({action: "open_browser", target: "file:///etc/passwd"})` が拒否される
- [ ] `executeOsCommand({action: "open_browser", target: "smb://server/share"})` が拒否される
- [ ] `executeOsCommand({action: "open_folder", target: "C:\\Users\\{user}\\Documents"})` が成功する
- [ ] `executeOsCommand({action: "open_folder", target: "C:\\Windows"})` が拒否される(ホーム外)
- [ ] `executeOsCommand({action: "open_folder", target: "C:\\Users\\{user}\\..\\Windows"})` が拒否される
- [ ] `executeOsCommand({action: "open_folder", target: "relative/path"})` が拒否される(相対パス)
- [ ] `validateUrl("http://example.com")` が ok: true を返す
- [ ] `validateUrl("https://example.com")` が ok: true を返す
- [ ] `validatePath()` が `..` を含むパスを拒否する
- [ ] Vitest による単体テストが通る
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] 「メモ帳を開いて」とENEに頼む → メモ帳が起動する
- [ ] 「example.comを開いて」とENEに頼む → デフォルトブラウザで開く
- [ ] 「Documentsフォルダを開いて」とENEに頼む → エクスプローラで開く
- [ ] 「C:\Windowsを開いて」と頼む → ENEが「開けない」と返事する
- [ ] 各エラー時にキャラ口調のメッセージが返る

## やってはいけないこと

- ❌ `child_process.exec()` での任意コマンド実行(CLAUDE.md §7.2)
- ❌ シェル経由のコマンド実行(`{shell: true}` を spawn に渡さない)
- ❌ ホワイトリスト外の action を追加(必ずユーザー承認・CLAUDE.md §7.2)
- ❌ ホームディレクトリ外のパスへのアクセス許可
- ❌ http/https 以外のプロトコル許可
- ❌ パス検証を行わずに `shell.openPath` を呼ぶ
- ❌ ユーザー入力を直接 shell コマンド文字列に埋め込む
- ❌ エラー時に技術的詳細(スタックトレース等)をユーザーに見せる
- ❌ `notepad.exe` 以外のシステムコマンド(`cmd.exe`, `powershell.exe`等)を呼ぶ

## 完了の定義

`executeOsCommand(command)` を呼ぶと、ホワイトリスト方式で厳格に検証された上で
安全に OS 操作が実行される。不正な action / target はすべて拒否され、
キャラ口調のフォールバックメッセージが返る。

次のタスク(task_07)で Electron Main Process を実装する準備が整う。

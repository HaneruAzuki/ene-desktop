# Task 07: Electron Main Process 実装

## 目的

Electron の main process を実装する。透過ウィンドウ、タスクトレイ、
IPC ハンドラ、多重起動防止、ウィンドウ位置管理を担当する。
全レイヤーを統合し、Renderer process と通信する。

## 依存タスク

- task_01(Storage Layer 完了)
- task_02(Character Layer 完了)
- task_03(Memory Layer 完了)
- task_04(Knowledge Router 完了)
- task_05(Conversation Layer 完了)
- task_06(OS Integration 完了)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §4(IPC通信設計)
- 設計書 `docs/03_design.md` §7(起動とライフサイクル)
- 設計書 `docs/03_design.md` §8(透過ウィンドウ設計)
- 要件 `docs/02_requirements.md` §2.4(アプリ終了とタスクトレイ)
- 要件 `docs/02_requirements.md` §2.13(起動・終了)

## 実装範囲

### 1. IPC 型定義(`src/shared/types/ipc.ts`)

設計書 §4.2 に従って `EneAPI` インターフェースを実装。

```typescript
export interface EneAPI {
  // 会話関連
  sendMessage(text: string): Promise<ConversationResponse>;

  // キャラクター関連
  getCharacterInfo(): Promise<{ name: string; portraitPath: string }>;

  // 設定関連
  hasApiKey(): Promise<boolean>;
  saveApiKey(key: string): Promise<void>;

  // ウィンドウ操作
  moveWindow(x: number, y: number): Promise<void>;
  resetWindowPosition(): Promise<void>;
  setIgnoreMouseEvents(ignore: boolean): Promise<void>;

  // キャラ右クリックメニュー
  showCharacterContextMenu(): Promise<void>;

  // ライフサイクル
  onAppReady(callback: () => void): void;
  onError(callback: (error: string) => void): void;

  // タスクトレイ/コンテキストメニューからのイベント受信
  onOpenInputArea(callback: () => void): void;
  onResetPosition(callback: () => void): void;
}

declare global {
  interface Window {
    ene: EneAPI;
  }
}
```

### 2. Preload スクリプト(`src/preload/index.ts`)

設計書 §4.3 に従って実装。

```typescript
import { contextBridge, ipcRenderer } from "electron";

const eneAPI: EneAPI = {
  sendMessage: (text) => ipcRenderer.invoke("ene:send-message", text),
  getCharacterInfo: () => ipcRenderer.invoke("ene:get-character-info"),
  hasApiKey: () => ipcRenderer.invoke("ene:has-api-key"),
  saveApiKey: (key) => ipcRenderer.invoke("ene:save-api-key", key),
  moveWindow: (x, y) => ipcRenderer.invoke("ene:move-window", x, y),
  resetWindowPosition: () => ipcRenderer.invoke("ene:reset-window-position"),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke("ene:set-ignore-mouse-events", ignore),
  showCharacterContextMenu: () => ipcRenderer.invoke("ene:show-character-context-menu"),
  onAppReady: (cb) => ipcRenderer.on("ene:app-ready", cb),
  onError: (cb) => ipcRenderer.on("ene:error", (_, error) => cb(error)),
  onOpenInputArea: (cb) => ipcRenderer.on("ene:open-input-area", cb),
  onResetPosition: (cb) => ipcRenderer.on("ene:reset-position", cb),
};

contextBridge.exposeInMainWorld("ene", eneAPI);
```

#### セキュリティ設定(設計書 §4.4)

main で BrowserWindow 作成時:
```typescript
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: path.join(__dirname, "../preload/index.js"),
}
```

### 3. 透過ウィンドウ作成(`src/main/window.ts`)

設計書 §8.1 に従って実装。

```typescript
export function createMainWindow(): BrowserWindow;
```

#### ウィンドウ仕様(設計書 §8.1)

| 項目 | 値 |
|------|-----|
| サイズ | 240×320(キャラ画像に合わせる) |
| transparent | true |
| frame | false |
| alwaysOnTop | true |
| resizable | false |
| hasShadow | false |
| skipTaskbar | true(タスクバーに表示しない・タスクトレイ運用) |

#### 位置の復元

- `data/config/window-position.json` を読込
- 存在しない場合は画面右下に配置
- 画面外に出ていたら画面内に補正(別モニタ取り外し対応)

### 4. ウィンドウ位置管理(`src/main/window-position.ts`)

```typescript
export async function saveWindowPosition(x: number, y: number): Promise<void>;
export async function loadWindowPosition(): Promise<{ x: number; y: number } | null>;
export function calculateDefaultPosition(): { x: number; y: number };
// 画面右下のデフォルト位置を計算

export function resetToDefaultPosition(window: BrowserWindow): void;
// キャラ右クリック「位置をリセット」で呼ばれる
```

### 5. タスクトレイ(`src/main/tray.ts`)

設計書 §8.8 に従って実装。

```typescript
export function createTray(mainWindow: BrowserWindow): Tray;
```

#### トレイメニュー構造

```
タスクトレイアイコン(右クリック):
├─ ENE を表示 / 隠す
├─ ENE と話す
├─ ─────────────
├─ ENE について
└─ ENE を終了
```

#### シングルクリック動作

- 表示中なら非表示に、非表示なら表示
- ダブルクリックも同等

### 6. キャラ右クリックメニュー(`src/main/character-context-menu.ts`)

設計書 §8.8 に従って実装。

```typescript
export function showCharacterContextMenu(window: BrowserWindow): void;
```

#### メニュー構造

```
キャラ上で右クリック:
├─ 話す
├─ ─────────────
├─ 位置をリセット
├─ APIキーを設定...
├─ ─────────────
└─ じゃあね...
```

「APIキーを設定...」は task_09 で実装する `openApiKeyDialog()` を呼ぶ。
本タスクではダイアログ関数は仮実装(空関数)でもよい。

### 7. IPC ハンドラ集約(`src/main/ipc.ts`)

```typescript
export function registerIpcHandlers(mainWindow: BrowserWindow): void;
```

#### 各ハンドラの実装方針

```typescript
// 会話処理
ipcMain.handle("ene:send-message", async (event, text: string) => {
  // 1. 短期記憶に追記(user)
  // 2. Memory Context 構築
  // 3. Router 呼出
  // 4. Conversation 呼出
  // 5. 短期記憶に追記(assistant)
  // 6. OS command なら executeOsCommand 呼出
  // 7. ConversationResponse を返す
});

ipcMain.handle("ene:get-character-info", async () => {
  // CharacterContext から name と portraitPath を返す
});

ipcMain.handle("ene:has-api-key", async () => {
  return isApiKeyAvailable();
});

ipcMain.handle("ene:save-api-key", async (event, key: string) => {
  // task_09 のロジックを呼ぶ
});

ipcMain.handle("ene:move-window", async (event, x: number, y: number) => {
  mainWindow.setBounds({ x, y, width: 240, height: 320 });
  await saveWindowPosition(x, y);
});

ipcMain.handle("ene:reset-window-position", async () => {
  resetToDefaultPosition(mainWindow);
});

ipcMain.handle("ene:set-ignore-mouse-events", async (event, ignore: boolean) => {
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.handle("ene:show-character-context-menu", async () => {
  showCharacterContextMenu(mainWindow);
});
```

### 8. 多重起動防止(`src/main/single-instance.ts`)

task_01 で実装済みの `acquireSingleInstanceLock()` を使用。

main の最初で:
```typescript
if (!acquireSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// 2つ目の起動が試みられた時、既存ウィンドウを前面に表示
app.on("second-instance", () => {
  mainWindow.show();
  mainWindow.focus();
});
```

### 9. エントリポイント(`src/main/index.ts`)

```typescript
async function main() {
  // 多重起動チェック
  if (!acquireSingleInstanceLock()) {
    app.quit();
    return;
  }

  await app.whenReady();

  // 起動シーケンスは task_10 で実装(本タスクでは最小限)
  // 本タスクでは:
  // 1. createMainWindow()
  // 2. createTray()
  // 3. registerIpcHandlers()

  app.on("window-all-closed", () => {
    app.quit();
  });
}

main();
```

完全な起動シーケンスは task_10 で実装する(API キー確認・active キャラ読込等を統合)。

## 受入チェックリスト

### 自動チェック

- [ ] BrowserWindow が `transparent: true, frame: false` で作成される
- [ ] webPreferences の `contextIsolation: true, sandbox: true` が設定されている
- [ ] 2つ目のプロセス起動時に静かに終了する
- [ ] 2つ目のプロセス起動時に既存ウィンドウが前面に出る
- [ ] ウィンドウ位置が `data/config/window-position.json` に保存される
- [ ] 起動時にウィンドウ位置が復元される(前回終了時の位置)
- [ ] 画面外にウィンドウが出ていた場合、画面内に補正される
- [ ] タスクトレイアイコンが表示される
- [ ] タスクトレイ右クリックメニューが正しく表示される
- [ ] キャラ右クリックメニューが正しく表示される
- [ ] IPC で `setIgnoreMouseEvents(true, { forward: true })` が呼ばれる
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] アプリ起動時、画面右下に透過ウィンドウが出現する(初回)
- [ ] ウィンドウのフレーム(タイトルバー)が表示されていない
- [ ] ウィンドウが最前面に固定されている(他アプリで隠れない)
- [ ] タスクバーに ENE が表示されない(タスクトレイのみ)
- [ ] タスクトレイ「ENE を終了」でアプリが終了する
- [ ] キャラ右クリック「じゃあね...」でアプリが終了する
- [ ] キャラ右クリック「位置をリセット」で画面右下に戻る
- [ ] 2つ目を起動しようとしても、新しいウィンドウが開かず既存が前面に出る

## やってはいけないこと

- ❌ `nodeIntegration: true` の設定(セキュリティリスク)
- ❌ `contextIsolation: false` の設定
- ❌ `sandbox: false` の設定
- ❌ Renderer Process でファイルシステム直接アクセスを許可(IPC 必須)
- ❌ IPC ハンドラ内で例外を漏らす(Renderer 側でクラッシュする)
- ❌ ウィンドウの「×」ボタンを追加(フレームレス設計)
- ❌ skipTaskbar: false(タスクバーに表示すべきでない)
- ❌ 起動シーケンス全体をこのタスクで実装(task_10 で統合)
- ❌ Renderer に Anthropic SDK を直接呼ばせる(API キーが漏れる)

## 完了の定義

`npm run dev` で透過ウィンドウとタスクトレイが起動し、IPC ハンドラが
すべて登録されている状態。ウィンドウ移動・位置保存・多重起動防止が動作する。
ただし完全な会話機能は task_10 で組み立てる。

次のタスク(task_08)で Renderer UI を実装する準備が整う。

# Task 09: APIキー管理ダイアログ実装

## 目的

初回起動時・キー失効時・ユーザー任意操作時に表示する APIキー管理ダイアログを実装する。
形式バリデーション・疎通テスト・エラー種別の区別・後からの変更手段を提供する。

## 依存タスク

- task_01(Storage Layer 完了 — encryption を使用)
- task_07(Electron Main 完了 — BrowserWindow を新規作成)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §3.7(APIキー管理ダイアログ)
- 要件 `docs/02_requirements.md` §2.12(APIキー管理 F-KEY-01〜10)

## 実装範囲

### 1. ダイアログウィンドウ作成(`src/main/api-key-dialog.ts`)

```typescript
export async function openApiKeyDialog(): Promise<{ ok: boolean }>;
// モーダルダイアログを開き、保存成功なら ok: true、キャンセルなら ok: false
```

#### ウィンドウ仕様

- BrowserWindow を新規作成(モーダル)
- サイズ:約 500×500
- 親ウィンドウは ENE のメインウィンドウ
- frame: true(通常のタイトルバー表示)
- resizable: false
- modal: true
- 親ウィンドウから派生(他アプリよりも前面に表示される必要あり)

### 2. ダイアログ用 Renderer(`src/renderer/api-key-dialog/`)

メインの Renderer とは別の HTML / TSX を用意。

```
src/renderer/api-key-dialog/
├── index.html
├── main.tsx
├── ApiKeyDialog.tsx
└── styles.css
```

#### ApiKeyDialog.tsx の構成

```typescript
function ApiKeyDialog() {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<TestStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 形式バリデーション(設計書 §3.7 段階1)
  const isFormatValid = key.startsWith("sk-ant-") && key.length >= 50;

  // 接続テストボタン
  async function handleTest() {
    setStatus("testing");
    const result = await window.eneApiKey.testApiKey(key);
    if (result.ok) {
      setStatus("success");
    } else {
      setStatus("failed");
      setErrorMessage(getErrorMessage(result.reason));
    }
  }

  // 保存ボタン
  async function handleSave() {
    // テスト未実施なら自動でテスト
    if (status !== "success") {
      await handleTest();
      if (status !== "success") return;
    }
    await window.eneApiKey.saveApiKey(key);
    window.eneApiKey.closeDialog(true);
  }

  return (
    <div className="dialog">
      <h1>ENE をはじめる準備</h1>
      <p>ENE と会話するには、Anthropic の API キーが必要です。</p>

      <button onClick={() => window.eneApiKey.openAnthropicConsole()}>
        Anthropic Console を開く
      </button>

      <ol>
        <li>Anthropic Console にサインアップ</li>
        <li>「API Keys」から新しいキーを作成</li>
        <li>利用にはクレジット購入が必要(無料枠あり)</li>
        <li>作成したキー(sk-ant-...)を下に貼り付け</li>
      </ol>

      <div className="key-input">
        <input
          type="password"  /* マスク表示 */
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-..."
        />
        <button disabled={!isFormatValid || status === "testing"} onClick={handleTest}>
          接続テスト
        </button>
      </div>

      <div className="status">
        {status === "idle" && "未入力"}
        {status === "testing" && "検証中..."}
        {status === "success" && "✓ 接続できました"}
        {status === "failed" && `✗ ${errorMessage}`}
      </div>

      <p className="note">
        ※ キーはあなたのPC内に暗号化保存されます<br />
        ※ Anthropic 以外には送信しません
      </p>

      <div className="buttons">
        <button onClick={() => window.eneApiKey.closeDialog(false)}>キャンセル</button>
        <button disabled={!isFormatValid} onClick={handleSave}>保存して始める</button>
      </div>
    </div>
  );
}
```

### 3. ダイアログ用 Preload(`src/preload/api-key-dialog-preload.ts`)

ダイアログ専用の `window.eneApiKey` を expose する(メインの `window.ene` とは別)。

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("eneApiKey", {
  testApiKey: (key: string) => ipcRenderer.invoke("ene-key:test", key),
  saveApiKey: (key: string) => ipcRenderer.invoke("ene-key:save", key),
  openAnthropicConsole: () => ipcRenderer.invoke("ene-key:open-console"),
  closeDialog: (ok: boolean) => ipcRenderer.invoke("ene-key:close", ok),
});
```

### 4. 疎通テストロジック(`src/main/api-key-tester.ts`)

設計書 §3.7「バリデーションの3段階」段階2 に従って実装。

```typescript
import Anthropic from "@anthropic-ai/sdk";

export type PingResult =
  | { ok: true }
  | { ok: false; reason: "auth" | "credit" | "network" | "other"; detail?: string };

export async function testApiKey(key: string): Promise<PingResult> {
  try {
    const client = new Anthropic({ apiKey: key });
    await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true };
  } catch (e: any) {
    if (e.status === 401) return { ok: false, reason: "auth" };
    if (e.status === 402 || e.status === 429) return { ok: false, reason: "credit" };
    if (e.code === "ENOTFOUND" || e.code === "ETIMEDOUT") return { ok: false, reason: "network" };
    return { ok: false, reason: "other", detail: String(e) };
  }
}
```

### 5. エラーメッセージ(`src/main/api-key-error-messages.ts`)

設計書 §3.7「エラー種別ごとのユーザー表示」に従って実装。

```typescript
export function getErrorMessage(reason: PingResult extends { ok: false; reason: infer R } ? R : never): string {
  switch (reason) {
    case "auth":
      return "APIキーが無効です。コピー漏れがないか確認してください。";
    case "credit":
      return "クレジット残高が不足しているか、レート上限に達しています。Anthropic Console で確認してください。";
    case "network":
      return "Anthropic に接続できませんでした。インターネット接続を確認してください。";
    case "other":
      return "予期しないエラーが発生しました。";
  }
}
```

### 6. ダイアログ用 IPC ハンドラ(`src/main/api-key-dialog-ipc.ts`)

```typescript
export function registerApiKeyDialogIpc(dialogWindow: BrowserWindow, onClose: (ok: boolean) => void) {
  ipcMain.handle("ene-key:test", async (event, key: string) => {
    return testApiKey(key);
  });

  ipcMain.handle("ene-key:save", async (event, key: string) => {
    // 保存前にもう一度テスト(念のため)
    const result = await testApiKey(key);
    if (!result.ok) {
      throw new Error("Cannot save invalid API key");
    }
    await encryptAndSaveApiKey(key);
  });

  ipcMain.handle("ene-key:open-console", async () => {
    await shell.openExternal("https://console.anthropic.com/");
  });

  ipcMain.handle("ene-key:close", async (event, ok: boolean) => {
    dialogWindow.close();
    onClose(ok);
  });
}
```

### 7. 自動再表示ロジック(`src/main/api-key-auto-recovery.ts`)

設計書 §6.1 のエラー対応表に従って、401/402/429 検知時にダイアログを再表示する。

```typescript
export async function handleApiAuthError(error: any): Promise<void> {
  // Conversation Layer の chat() 内、Router の classifyTopic() 内で
  // 401/402/429 をキャッチしたら本関数を呼ぶ
  log.error(`API authentication error: ${error.status}`);
  await openApiKeyDialog();
}
```

**呼出元**:Conversation Layer / Knowledge Router の catch ブロックから呼ばれる。
本タスクではこの関数を提供するのみ。実際の呼出は task_05 / task_04 のコードを
本タスクで追加修正することになる。

### 8. 起動時のダイアログ表示判定

`src/main/index.ts`(または task_10 の起動シーケンス)で:

```typescript
if (!(await isApiKeyAvailable())) {
  const result = await openApiKeyDialog();
  if (!result.ok) {
    // ユーザーがキャンセル → アプリ終了
    app.quit();
    return;
  }
}
// 以降の起動処理
```

ただし、task_10 の起動シーケンスで統合するため、本タスクでは関数提供のみで OK。

## 受入チェックリスト

### 自動チェック

- [ ] `openApiKeyDialog()` でモーダルダイアログが表示される
- [ ] ダイアログの入力欄が password type(マスク表示)
- [ ] `sk-ant-...` 以外の形式で「保存」ボタンが無効化される
- [ ] 50文字未満で「保存」ボタンが無効化される
- [ ] 「接続テスト」ボタンで `testApiKey` が呼ばれる
- [ ] 「Anthropic Console を開く」で `shell.openExternal` が呼ばれる
- [ ] 「キャンセル」で `closeDialog(false)` が呼ばれる
- [ ] 「保存して始める」で `closeDialog(true)` が呼ばれる(テスト成功時)
- [ ] テスト失敗時に「保存」が実行されない
- [ ] `getErrorMessage("auth")` が「APIキーが無効です」を含む文字列を返す
- [ ] `getErrorMessage("credit")` が「クレジット」「レート上限」を含む文字列を返す
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] 初回起動時にダイアログが自動表示される
- [ ] 不正なキー(例:`invalid-key`)で「保存」ボタンが押せない
- [ ] 正しいキーで「接続テスト」を押すと「✓ 接続できました」が表示される
- [ ] 偽のキー(`sk-ant-xxx...`)で「接続テスト」を押すと「APIキーが無効です」が表示される
- [ ] 「Anthropic Console を開く」でブラウザが開く
- [ ] キャラ右クリック「APIキーを設定...」でダイアログが再表示される
- [ ] 保存後にダイアログが閉じて、ENEと会話可能になる

## やってはいけないこと

- ❌ APIキーを `data/` 配下に保存(必ず `%APPDATA%`)
- ❌ APIキーをログに出力(設計書 §6.2)
- ❌ APIキーを平文で長時間メモリ保持(SDKインスタンス経由でのみ使用)
- ❌ 疎通テスト未実施でキーを保存
- ❌ エラー詳細(スタックトレース)をユーザーに見せる
- ❌ ダイアログを Renderer から作る(必ず main 経由)
- ❌ Anthropic Console URL をハードコード以外の場所から取得(セキュリティ)
- ❌ ダイアログ内でメインウィンドウの window.ene を呼ぶ(別 preload を使う)

## 完了の定義

初回起動時にダイアログが出て、ユーザーが API キーを入力・テスト・保存できる。
キー失効時(401/402/429)に自動的にダイアログが再表示される。
キャラ右クリック「APIキーを設定...」でも再表示できる。

次のタスク(task_10)で起動シーケンス全体を統合する準備が整う。

# Task 10: 起動シーケンス統合

## 目的

全レイヤー(task_01〜task_09)を組み合わせて、設計書 §7「起動とライフサイクル」
の起動シーケンス11ステップと終了シーケンスを統合実装する。これでアプリが
完全に動作する状態になる。

## 依存タスク

- task_01〜task_09 すべて完了

## 関連ドキュメント

- 設計書 `docs/03_design.md` §7(起動とライフサイクル)
- 設計書 `docs/03_design.md` §8.7(初回起動時のユーザーガイド)
- 要件 `docs/02_requirements.md` §2.13(起動・終了)

## 実装範囲

### 1. 起動シーケンス本体(`src/main/lifecycle.ts`)

設計書 §7.1 の11ステップを統合実装。

```typescript
export async function runStartupSequence(): Promise<{
  charContext: CharacterContext;
  active: ActiveCharacter;
  apiKey: string;
}>;
```

#### 11ステップの実装

```typescript
async function runStartupSequence() {
  // Step 1: 多重起動チェック(task_01 / task_07 で実装済み)
  if (!acquireSingleInstanceLock()) {
    log.info("Another instance is running");
    app.quit();
    process.exit(0);
  }

  // Step 2: app.whenReady() 待機
  await app.whenReady();
  log.info("App ready");

  // Step 3: ポータブル書込チェック
  const dataDir = getPortableDataDir();
  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.access(dataDir, fs.constants.W_OK);
  } catch (e) {
    dialog.showErrorBox(
      "起動できません",
      `データ保存先 ${dataDir} に書き込めません。別の場所から実行してください。`
    );
    app.quit();
    throw e;
  }

  // Step 4: クラウド同期フォルダ警告チェック
  if (isCloudSyncFolder(dataDir)) {
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "クラウド同期フォルダの警告",
      message: "現在の場所はクラウド同期フォルダ(OneDrive 等)の配下です。\n"
             + "データの整合性に問題が出る可能性があります。続行しますか?",
      buttons: ["続行", "終了"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 1) {
      app.quit();
      throw new Error("User chose to quit");
    }
  }

  // Step 5: APIキー確認
  let apiKey = await loadAndDecryptApiKey();
  if (!apiKey) {
    const result = await openApiKeyDialog();
    if (!result.ok) {
      app.quit();
      throw new Error("User cancelled API key setup");
    }
    apiKey = await loadAndDecryptApiKey();
    if (!apiKey) {
      throw new Error("Failed to load API key after dialog");
    }
  }

  // Step 6: active-character.json 読込
  const active = await loadOrCreateActiveCharacter();
  log.info(`Active character: ${active.characterId}`);

  // Step 7: Character Profile ロード
  let charContext: CharacterContext;
  try {
    charContext = await buildCharacterContext();
  } catch (e) {
    dialog.showErrorBox(
      "キャラクター読み込みエラー",
      `${active.characterId} のプロファイルを読み込めませんでした。`
    );
    app.quit();
    throw e;
  }

  // Step 8: 記憶データのロード(ディレクトリ初期化)
  await ensureMemoryDirectories(active.characterId);

  // 異常終了対策:残った短期記憶があれば抽出を試みる(設計書 §7.3)
  const orphanedShortTerm = await getUnextractedEntries();
  if (orphanedShortTerm.length > 0) {
    try {
      await extractFromShortTerm("shutdown", charContext);
      await clearShortTerm();
      log.info(`Recovered ${orphanedShortTerm.length} orphaned entries`);
    } catch (e) {
      log.warn("Failed to recover orphaned short-term memory");
      // 続行(致命的ではない)
    }
  }

  // Step 9: 誕生日チェック
  const today = todayLocalYmd();
  const birthdayStatus = checkBirthday(charContext.identity, active, today);
  charContext = { ...charContext, birthdayHint: birthdayStatus };

  // Step 10: 透過ウィンドウ作成・表示
  const mainWindow = createMainWindow();
  registerIpcHandlers(mainWindow, charContext, apiKey);
  createTray(mainWindow);

  // Step 11: 起動完了通知 + キャラ挨拶
  mainWindow.webContents.on("did-finish-load", async () => {
    const greeting = await generateGreeting(active, charContext);
    mainWindow.webContents.send("ene:initial-greeting", greeting);

    if (!active.firstLaunchCompleted) {
      await markFirstLaunchCompleted();
    }
  });

  return { charContext, active, apiKey };
}
```

### 2. 記憶ディレクトリ初期化(`src/main/init-directories.ts`)

```typescript
export async function ensureMemoryDirectories(characterId: string): Promise<void>;
// data/memory/{characterId}/episodic/ を再帰的に作成
// data/config/ を作成
// data/logs/ を作成
```

### 3. 起動挨拶生成(`src/main/greeting.ts`)

設計書 §8.7 に従って実装。

```typescript
export async function generateGreeting(
  active: ActiveCharacter,
  charContext: CharacterContext
): Promise<string>;
```

#### 動作仕様

```typescript
function generateGreeting(active, charContext) {
  const fewshot = charContext.fewshot;

  if (!active.firstLaunchCompleted && fewshot.firstLaunchGreeting?.length) {
    // 初回起動:firstLaunchGreeting からランダム選択
    return randomChoice(fewshot.firstLaunchGreeting).assistant;
  }

  // 通常起動:normalGreeting からランダム選択
  if (fewshot.normalGreeting?.length) {
    return randomChoice(fewshot.normalGreeting).assistant;
  }

  // フォールバック(キャラ依存しない汎用挨拶)
  return "...こんにちは。";
}
```

### 4. 初回挨拶受信(Renderer 側追記)

`src/renderer/App.tsx` に追記:

```typescript
useEffect(() => {
  window.ene.onInitialGreeting((greeting) => {
    setBubbleMessage(greeting);
  });
}, []);
```

対応する preload と IPC ハンドラも追加。

### 5. 短期記憶 append 統合

`registerIpcHandlers` 内の `ene:send-message` ハンドラを完全実装。

```typescript
ipcMain.handle("ene:send-message", async (event, text: string) => {
  try {
    // 1. 短期記憶に追記(user)
    await appendShortTerm({
      role: "user",
      text,
      timestamp: nowLocalIso(),
      extracted: false,
    });

    // 2. Memory Context 構築
    const memoryContext = await buildMemoryContext({
      tags: [],  // タグはユーザー入力から抽出するロジックを将来追加
      limit: 5,
    });

    // 3. Knowledge Router
    const routerResult = await classifyTopic(text, charContext.knowledgeDomains, apiKey);

    // 4. Conversation Layer
    let response: ConversationResponse;
    try {
      response = await chat(text, charContext, memoryContext, routerResult, apiKey);
    } catch (e: any) {
      if (e.status === 401 || e.status === 402 || e.status === 429) {
        await handleApiAuthError(e);
      }
      response = { type: "chat", message: "…ごめん、ちょっと調子悪いみたい。" };
    }

    // 5. 短期記憶に追記(assistant)
    await appendShortTerm({
      role: "assistant",
      text: response.message,
      timestamp: nowLocalIso(),
      extracted: false,
    });

    // 6. OS command なら実行
    if (response.type === "os_command") {
      const osResult = await executeOsCommand(response.command);
      if (!osResult.ok) {
        // 失敗時、Conversation の message が既にキャラ口調なのでそれを使う
        // (設計書 §3.5 の方針)
      }
    }

    // 7. 誕生日が "today" の状態でユーザーが「誕生日おめでとう」等の語を含んでいたら
    //    birthdayHistory を更新
    if (charContext.birthdayHint === "today") {
      const congrats = ["誕生日", "おめでとう", "ハッピーバースデー", "Happy Birthday"];
      if (congrats.some((w) => text.includes(w))) {
        await recordBirthdayCelebrated(today.year);
      }
    }

    return response;
  } catch (e) {
    log.error("Error in ene:send-message", { error: String(e) });
    return { type: "chat", message: "えっと…ちょっと調子悪いみたい。" };
  }
});
```

### 6. 終了シーケンス(`src/main/shutdown.ts`)

設計書 §7.2 に従って実装。

```typescript
export async function runShutdownSequence(charContext: CharacterContext): Promise<void>;
```

```typescript
async function runShutdownSequence(charContext) {
  log.info("Shutdown sequence started");

  // 1. 短期記憶から未抽出エントリの抽出
  try {
    await extractFromShortTerm("shutdown", charContext);
  } catch (e) {
    log.warn("Memory extraction on shutdown failed", { error: String(e) });
    // 続行(記憶が失われるが、アプリは終了する)
  }

  // 2. 短期記憶ファイル削除
  try {
    await clearShortTerm();
  } catch (e) {
    log.warn("Failed to clear short-term memory");
  }

  // 3. ウィンドウ位置保存(IPC ハンドラで既に保存されている前提)
  //    ただし最終状態を確実に保存するため、ここで再保存してもよい

  // 4. ログフラッシュ
  log.info("Shutdown sequence complete");

  // 5. アプリ終了は呼出元(app.on("before-quit"))で
}
```

### 7. main entry の最終形(`src/main/index.ts`)

```typescript
async function main() {
  let charContext: CharacterContext | null = null;

  app.on("before-quit", async (e) => {
    if (charContext) {
      e.preventDefault();
      await runShutdownSequence(charContext);
      charContext = null;
      app.quit();
    }
  });

  try {
    const result = await runStartupSequence();
    charContext = result.charContext;
  } catch (e) {
    log.error("Startup failed", { error: String(e) });
    app.quit();
  }
}

main();
```

## 受入チェックリスト

### 自動チェック

- [ ] 初回起動時にAPIキーダイアログが自動表示される
- [ ] APIキーをキャンセルすると app.quit() される
- [ ] APIキー保存後、ENE が起動する
- [ ] 多重起動時に2つ目のプロセスが静かに終了する
- [ ] 異常終了後の起動で、残った短期記憶が抽出される
- [ ] 終了時に未抽出エントリが Episodic に保存される
- [ ] 終了時に短期記憶ファイルが削除される
- [ ] 「メモ帳開いて」で os_command が実行される
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] 初回起動時、ENE が `firstLaunchGreeting` から挨拶する
- [ ] 2回目以降の起動で、ENE が `normalGreeting` から挨拶する
- [ ] 初回起動完了後、`active-character.json` の `firstLaunchCompleted` が true になる
- [ ] 誕生日当日に起動すると、ENE が誕生日反応を見せる
- [ ] ユーザーが「おめでとう」と言った後、翌日起動しても "forgotten" 反応にならない
- [ ] クラウド同期フォルダ配下から起動すると警告が出る
- [ ] アプリを正常終了すると、新しい Episodic Memory ファイルが生成される
- [ ] アプリを強制終了(タスクマネージャ)してから再起動すると、未抽出記憶が復元抽出される
- [ ] 数回の会話後、過去の話題を出すと ENE が「覚えている」反応をする

## やってはいけないこと

- ❌ 起動シーケンス中に例外を吐き捨てる(必ずユーザーに分かるエラー表示)
- ❌ Step 5(APIキー確認)をスキップ
- ❌ Step 6(active-character.json)を読まずにキャラをハードコードで指定
- ❌ 異常終了対策をスキップ(設計書 §7.3 必須)
- ❌ Step 11(キャラ挨拶)を `did-finish-load` 前に送信(レンダリング前で消える)
- ❌ 終了時の抽出処理をスキップ(記憶が失われる)
- ❌ 終了処理を同期的に書く(`before-quit` で preventDefault しないと終了が早すぎる)
- ❌ 起動シーケンスを Renderer 側で実装(必ず main 側)
- ❌ クラウド同期警告を抑制(セキュリティリスク)

## 完了の定義

`npm run dev` で全機能が動く状態。初回起動 → API キー設定 → キャラ挨拶 →
会話 → OS 操作 → 終了時の記憶抽出 → 再起動時の記憶復元、すべてが連動して動く。

次のタスク(task_11)でビルド・配布の準備に進める。

# Task 08: Renderer UI 実装

## 目的

React で透過ウィンドウ内のキャラ表示、入力欄、応答吹き出しを実装する。
マウス操作判別、透明領域クリックスルー、初回起動ガイドの表示も担当する。

## 依存タスク

- task_07(Electron Main + IPC 完了 — `window.ene.*` を呼ぶ)

## 関連ドキュメント

- 設計書 `docs/03_design.md` §8.2(マウス操作の判別)
- 設計書 `docs/03_design.md` §8.3(移動操作)
- 設計書 `docs/03_design.md` §8.4(入力欄)
- 設計書 `docs/03_design.md` §8.5(応答吹き出し)
- 設計書 `docs/03_design.md` §8.6(透明領域のクリックスルー)
- 設計書 `docs/03_design.md` §8.7(初回起動ガイド)
- 要件 `docs/02_requirements.md` §2.2 / §2.3

## 実装範囲

### 1. 定数定義(`src/renderer/constants.ts`)

設計書 §8.2 §8.5 の各定数を一元管理。

```typescript
// マウス操作判別(§8.2)
export const DRAG_THRESHOLD_PX = 5;
export const CLICK_MAX_DURATION_MS = 500;

// 吹き出し(§8.5)
export const BUBBLE_AUTO_DISMISS_MS = 30_000;
export const BUBBLE_MAX_WIDTH_PX = 240;
export const BUBBLE_MAX_HEIGHT_PX = 400;
```

### 2. App.tsx(トップコンポーネント)

```typescript
// src/renderer/App.tsx

export function App() {
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const [inputAreaVisible, setInputAreaVisible] = useState(false);
  const [bubbleMessage, setBubbleMessage] = useState<string | null>(null);

  // 起動時に CharacterInfo を取得
  useEffect(() => {
    window.ene.getCharacterInfo().then(setCharacterInfo);
  }, []);

  // タスクトレイ / コンテキストメニューからのイベント
  useEffect(() => {
    window.ene.onOpenInputArea(() => setInputAreaVisible(true));
    window.ene.onResetPosition(() => { /* 何もしない・main側で処理 */ });
  }, []);

  // ESC で入力欄・吹き出しを閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInputAreaVisible(false);
        setBubbleMessage(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!characterInfo) return null;

  return (
    <div className="app">
      <CharacterDisplay
        portraitPath={characterInfo.portraitPath}
        onClick={() => setInputAreaVisible(true)}
      />
      {bubbleMessage && (
        <SpeechBubble
          message={bubbleMessage}
          onClose={() => setBubbleMessage(null)}
        />
      )}
      {inputAreaVisible && (
        <InputArea
          onSubmit={async (text) => {
            setBubbleMessage(null);  // 古い吹き出しを即消去
            setInputAreaVisible(false);
            const response = await window.ene.sendMessage(text);
            setBubbleMessage(response.message);
          }}
          onClose={() => setInputAreaVisible(false)}
        />
      )}
    </div>
  );
}
```

### 3. CharacterDisplay(`src/renderer/components/CharacterDisplay.tsx`)

#### 責務

- キャラPNG画像の表示
- マウス操作の判別(クリック / ドラッグ / 長押し)
- 透明領域のクリックスルー制御
- 右クリックでコンテキストメニュー表示

#### 実装方針

```typescript
function CharacterDisplay({ portraitPath, onClick }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 初回マウント時に画像を Canvas に描画(alpha 読取用)
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(img, 0, 0);
    canvasRef.current = canvas;
  }, [portraitPath]);

  // マウス操作判別(§8.2)
  const dragStateRef = useRef<{
    startX: number; startY: number; startTime: number; isDragging: boolean;
  } | null>(null);

  function onMouseDown(e: React.MouseEvent) {
    dragStateRef.current = {
      startX: e.screenX, startY: e.screenY,
      startTime: Date.now(), isDragging: false,
    };
  }

  function onMouseMove(e: React.MouseEvent) {
    // クリックスルー判定(§8.6)
    const isOnOpaque = checkOpaquePixel(canvasRef.current, e.clientX, e.clientY);
    window.ene.setIgnoreMouseEvents(!isOnOpaque);

    // ドラッグ判定
    const state = dragStateRef.current;
    if (!state) return;
    const distance = Math.hypot(e.screenX - state.startX, e.screenY - state.startY);
    if (distance >= DRAG_THRESHOLD_PX && !state.isDragging) {
      state.isDragging = true;
    }
    if (state.isDragging) {
      window.ene.moveWindow(/* 計算した新座標 */);
    }
  }

  function onMouseUp(e: React.MouseEvent) {
    const state = dragStateRef.current;
    if (!state) return;
    dragStateRef.current = null;

    if (state.isDragging) return;  // ドラッグなら何もしない
    const elapsed = Date.now() - state.startTime;
    if (elapsed < CLICK_MAX_DURATION_MS) {
      onClick();  // クリック判定 → 入力欄展開
    }
    // 長押しは何もしない(誤操作回避)
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    window.ene.showCharacterContextMenu();
  }

  return (
    <img
      ref={imgRef}
      src={portraitPath}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      draggable={false}
    />
  );
}
```

#### 透明ピクセル判定(`checkOpaquePixel`)

```typescript
function checkOpaquePixel(canvas: HTMLCanvasElement | null, x: number, y: number): boolean {
  if (!canvas) return true;  // canvas 未準備なら安全側(不透明扱い)
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  return pixel[3] > 0;  // alpha が 0 より大きければ不透明
}
```

### 4. SpeechBubble(`src/renderer/components/SpeechBubble.tsx`)

設計書 §8.5 に従って実装。

```typescript
interface Props {
  message: string;
  onClose: () => void;
}

function SpeechBubble({ message, onClose }: Props) {
  // 30秒自動消滅(§8.5)
  useEffect(() => {
    const timer = setTimeout(onClose, BUBBLE_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div
      className="bubble"
      onClick={onClose}
      style={{
        maxWidth: `${BUBBLE_MAX_WIDTH_PX}px`,
        maxHeight: `${BUBBLE_MAX_HEIGHT_PX}px`,
        overflowY: "auto",
      }}
    >
      {message}
    </div>
  );
}
```

#### スタイル要件

- 横幅:固定(240px)
- 高さ:内容に応じて自動拡張(最大 400px、超過時スクロール)
- 背景:半透明(キャラの世界観に馴染む)
- 文字色:黒
- フォントサイズ:13〜14px
- 位置:キャラの上部(画面端で見切れる場合は下部に反転)

### 5. InputArea(`src/renderer/components/InputArea.tsx`)

```typescript
interface Props {
  onSubmit: (text: string) => void;
  onClose: () => void;
}

function InputArea({ onSubmit, onClose }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        onSubmit(text.trim());
        setText("");
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="ENEに話しかける..."
    />
  );
}
```

#### スタイル要件

- 位置:キャラの下部
- 横幅:約 240px
- 半透明背景
- Enter で送信、Shift+Enter で改行(任意)
- ESC で閉じる

### 6. main.tsx(`src/renderer/main.tsx`)

React のエントリポイント。

```typescript
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
```

### 7. スタイル(`src/renderer/styles.css`)

```css
* { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0;
  background: transparent;  /* 透過 */
  font-family: 'Segoe UI', 'Hiragino Sans', sans-serif;
  user-select: none;       /* ドラッグ時のテキスト選択を防ぐ */
}

.app {
  position: relative;
  width: 240px;
  height: 320px;
}

.bubble {
  position: absolute;
  /* キャラ上部に表示。画面端で反転は JS で計算する */
  background: rgba(255, 255, 255, 0.92);
  border-radius: 12px;
  padding: 12px;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* 入力欄、その他のスタイル */
```

### 8. index.html(`src/renderer/index.html`)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>ENE</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

## 受入チェックリスト

### 自動チェック

- [ ] `npm run dev` で React UI が透過ウィンドウ内に表示される
- [ ] CharacterDisplay がキャラPNGを表示する
- [ ] InputArea が初期表示されない(キャラのみ)
- [ ] CharacterDisplay クリックで InputArea が展開する
- [ ] InputArea で Enter キーを押すと `window.ene.sendMessage` が呼ばれる
- [ ] SpeechBubble が応答後に表示される
- [ ] SpeechBubble が 30秒後に自動消滅する
- [ ] SpeechBubble をクリックすると即座に閉じる
- [ ] ESC キーで InputArea と SpeechBubble が閉じる
- [ ] 新しい応答が来ると古い SpeechBubble が即座に消える
- [ ] CharacterDisplay 上の右クリックで `showCharacterContextMenu` が呼ばれる
- [ ] TypeScript strict コンパイルが通る

### 手動チェック

- [ ] ドラッグでキャラを画面内移動できる(5px以上動かす)
- [ ] 短いクリック(動かさず素早く離す)で入力欄が開く
- [ ] 長押し(動かさず長く押す)で何も起きない
- [ ] キャラの周りの透明領域でクリックすると、下のデスクトップアイコンが反応する(クリックスルー)
- [ ] キャラの不透明部分ではマウスイベントが受け取られる
- [ ] 入力欄に長文を入れて Enter で送信した時、応答が吹き出しに表示される
- [ ] 長文応答時に吹き出しがスクロール可能になる
- [ ] 吹き出しが最大 400px 高さで打ち切られる
- [ ] 画面端でも吹き出しが見切れない(反転または位置調整される)

## やってはいけないこと

- ❌ Renderer で Anthropic SDK 等を直接 import(必ず IPC 経由・設計書 §4.1)
- ❌ Renderer で `fs` や `child_process` を import
- ❌ `localStorage` / `sessionStorage` の使用(必要なら IPC で main 側で保存)
- ❌ ESLint disable で型エラーを回避
- ❌ Drag/Click 判定の数値をハードコード(`DRAG_THRESHOLD_PX` 等の定数を使う)
- ❌ ピクセル判定なしで `setIgnoreMouseEvents(true)` を設定(キャラと対話できなくなる)
- ❌ チュートリアルダイアログの表示(初回ガイドはキャラ自身が話す・§8.7)
- ❌ ENE のキャラ口調メッセージをコード内にハードコード(初回挨拶は fewshot.json から)

## 完了の定義

`npm run dev` で透過ウィンドウに ENE のキャラが表示され、
クリック・ドラッグ・右クリックが正しく判別され、
入力欄から ENE に話しかけて応答が吹き出しで返ってくる状態。
クリックスルーが機能して、デスクトップ操作が遮られない。

次のタスク(task_09)で APIキー管理ダイアログを実装する準備が整う。

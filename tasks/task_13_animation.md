# Task 13: アニメ基盤(MVP 0.2)

## 目的

MVP 0.1 の静止 PNG 1枚表示を、**状態機械(idle / thinking / talking ＋ emotion)で駆動する
スプライト・アニメーション**に拡張する。口パク・アイドル(まばたき/呼吸/稀に寝そべり)・
表情変化・「考える間」演出・クリック音を実装し、
**将来(0.3 音声リップシンク、1.0 Live2D/VRM)に差し替え可能な土台**を作る。

## 位置づけ・哲学

`docs/00_philosophy.md` のロードマップ **MVP 0.2「存在感」**。
関与する次元と役割:

- 感情(①機構最小/②演技):**emotion 離散ラベル → 表情差分**
- 応答速度(①最大化しない):**「考える間」をアニメで演出**(遅延をキャラ化)
- 声・口・表情アニメ(③人間/キャラ天井):**PNG 差分**(アイドル/寝そべり/口パク/表情)
- 能動性(下地):**状態機械 = 存在の下地**(本格的な自発発話は 0.3〜1.0)

設計則の尊重:**②有能さ→クセの順**(emotion はキャラ演技、賢さの誇示でない)、
**③手がかりの一貫性**(様式化アニメ・粒度をそろえる)、**§5.3 感情の数値管理は禁止**。

## 依存タスク

- task_07 / 08 / 10(現行 Renderer + IPC + 起動シーケンス)

## 関連ドキュメント

- `docs/00_philosophy.md` §6(次元と役割)・§7(ロードマップ 0.2)
- 設計書 `docs/03_design.md` §8(透過ウィンドウ)・§3.4(Conversation 応答型)・
  §11.2(表示差し替え)・§11.5(感情モデル)・§5.1(キャラ JSON)
- 要件 `docs/02_requirements.md` §2.1(F-DISP-06 アニメは任意)・§2.5(会話処理)

## 承認済みの構造追加(2026-06・ユーザー承認)

- **新ディレクトリ** `characters/{id}/sprites/`、**新ファイル** `characters/{id}/animation.json`
- **応答型** `ChatResponse` に `emotion?` フィールド追加
- **emotion 6種**:`neutral / joy / anger / sorrow / surprise / embarrassed`
  (表示概念:平常 / 喜び / 怒り(ツン) / 哀しみ / 驚き / 照れ(デレ))
- **新規 npm ライブラリは追加しない**(React + canvas + Web Audio で完結)
- 素材は**プレースホルダ先行**(既存 portrait.png 流用)→ VRoid 本番素材は後から差し替え

### レビューで確定した設計判断(2026-06)

1. **emotion ラベルの所在 = コード固定**(`EMOTION_LABELS`)。`ResponseType`/`OsAction` と同じ「層間の契約」。
   見た目(sprite)は animation.json、口調は few-shot に置く。語彙のキャラ別化は将来 identity.json の任意属性で対応。
2. **口パク中の表情ちらつき防止 = 感情ごとの口開きフレーム**(`base`=口閉じ / `baseOpen`=口開き を emotion 別に持つ)。
   合成はしない(VRoid で「表情＋口開け」を撮るだけ)。**呼吸は CSS transform**(スプライト不要)、**まばたきは 0.2 では実装しない**(枚数増のため後回し)。
3. **クリック音 = Web Audio で合成**(外部アセット・ライセンス確認ゼロ・新 dir 不要)。"かわいい" CC0 サンプルへの差し替えは 1.1 の磨きで。
4. **寝そべり(sofa)= 240×320 の枠内に収める**。`sofa` は **idle 専用**(thinking/talking に入ると stand に戻る=話しかけたら立ち上がる)。窓の動的リサイズはしない。

---

## 要件(F-ANIM)

| ID | 要件 |
|----|------|
| F-ANIM-01 | キャラ表示は状態機械(activity: idle / thinking / talking, emotion, pose)で駆動する |
| F-ANIM-02 | スプライト・状態→画像の対応・フレーム間隔は `characters/{id}/animation.json` で定義する(コードにハードコードしない) |
| F-ANIM-03 | idle 中は呼吸の微動(CSS)を再生し、長時間 idle で稀に寝そべり(sofa)へ遷移する(まばたきは 0.2 では実装しない) |
| F-ANIM-04 | 応答待ち(thinking)中は「考える」表示を出し、応答までの遅延をキャラ化する |
| F-ANIM-05 | 応答表示(talking)中は口パク(mouth open/closed の交互)を再生する。MVP 0.2 は時間ベース、0.3 で音声振幅ドリブンに差し替える |
| F-ANIM-06 | 会話応答に emotion 離散ラベルを含め、対応する表情スプライトへ切り替える。欠落・許可外ラベルは `neutral` にフォールバックする |
| F-ANIM-07 | emotion は 1 ターンごとの**揮発ラベル**。好感度・不機嫌度などの数値状態は持たない(§5.3) |
| F-ANIM-08 | クリックスルー判定(`isOpaqueAt`)は**現在表示中フレームの alpha** で行う |
| F-ANIM-09 | 視覚レンダラは `CharacterState` インターフェースで差し替え可能とする(将来 Live2D/VRM・§11.2) |
| F-ANIM-10 | クリック音等の UI 音は **Web Audio で合成**する(外部音源を同梱しない)。将来サンプルに差し替える場合は無料配布可(CC0 等)に限る |
| F-ANIM-11 | アニメ定義が無い・不正な場合は単一 portrait 表示にフォールバックする(後方互換) |
| F-ANIM-12 | フレーム間隔・まばたき/呼吸/口パク間隔等の数値は定数として一元管理する |

---

## 実装範囲

### 1. 型・定数

```typescript
// src/shared/types/animation.ts(新規)
export const EMOTION_LABELS = ['neutral','joy','anger','sorrow','surprise','embarrassed'] as const;
export type EmotionLabel = (typeof EMOTION_LABELS)[number];

export type CharacterActivity = 'idle' | 'thinking' | 'talking';
export type CharacterPose = 'stand' | 'sofa';

// Renderer が保持する単一の表示状態
export interface CharacterState {
  activity: CharacterActivity;
  emotion: EmotionLabel;
  pose: CharacterPose;
}

// animation.json のスキーマ
export interface CharacterAnimation {
  characterId: string;
  frameSize: { width: number; height: number };
  // フレーム名 → 画像ファイル名(characters/{id}/sprites/ 配下)
  frames: Record<string, string>;
  // 状態解決の対応表(下記「フレーム解決順」を参照)
  map: {
    base: Partial<Record<EmotionLabel, string>>;       // emotion → 口閉じフレーム
    baseOpen?: Partial<Record<EmotionLabel, string>>;  // emotion → 口開きフレーム(talking 用・任意)
    thinking?: string;                                 // thinking 用(任意)
    sofa?: string;                                     // 寝そべり(idle 専用・任意)
  };
  timing?: {
    mouthFlapMs?: number;                 // 口パクのフレーム切替間隔
    idleSwayMs?: number;                  // 呼吸(CSS transform)の周期
    sofaAfterIdleMs?: number;             // この時間 idle が続くと寝そべりへ
    // まばたきは 0.2 では持たない(フルフレーム方式では枚数が増えるため後回し)
  };
}
```

```typescript
// src/renderer/constants.ts(追記)
export const MOUTH_FLAP_MS = 150;          // talking: 口開閉の切替間隔
export const IDLE_SWAY_MS = 4000;          // idle: 呼吸(CSS transform)の周期
export const SOFA_AFTER_IDLE_MS = 60_000;  // この時間 idle が続くと寝そべりへ
// まばたきは 0.2 では実装しない(フルフレーム方式では枚数が増えるため後回し)
```

> 📌 **emotion ラベルの所在**:6 ラベルは全キャラ共通の語彙としてコード側(`EMOTION_LABELS`)に置く。
> **キャラ依存なのは「各ラベルに対応するスプライト(animation.json)」と「few-shot の口調」**であり、
> 語彙そのものは固定で良い(KISS)。将来キャラ別に語彙を変えたくなったら animation.json 側へ移す。

### 2. animation.json とスプライト(プレースホルダ)

```jsonc
// characters/ene/animation.json(プレースホルダ例)
{
  "characterId": "ene",
  "frameSize": { "width": 240, "height": 320 },
  "frames": {
    "neutral": "neutral.png",       "neutral_open": "neutral_open.png",
    "joy": "joy.png",               "joy_open": "joy_open.png",
    "anger": "anger.png",           "anger_open": "anger_open.png",
    "sorrow": "sorrow.png",         "sorrow_open": "sorrow_open.png",
    "surprise": "surprise.png",     "surprise_open": "surprise_open.png",
    "embarrassed": "embarrassed.png","embarrassed_open": "embarrassed_open.png",
    "thinking": "thinking.png",
    "sofa": "sofa.png"
  },
  "map": {
    "base": { "neutral": "neutral", "joy": "joy", "anger": "anger",
              "sorrow": "sorrow", "surprise": "surprise", "embarrassed": "embarrassed" },
    "baseOpen": { "neutral": "neutral_open", "joy": "joy_open", "anger": "anger_open",
                  "sorrow": "sorrow_open", "surprise": "surprise_open", "embarrassed": "embarrassed_open" },
    "thinking": "thinking",
    "sofa": "sofa"
  },
  "timing": { "mouthFlapMs": 150, "idleSwayMs": 4000, "sofaAfterIdleMs": 60000 }
}
```

- **プレースホルダ運用**:まず `characters/ene/sprites/` に**既存 portrait.png を全フレーム名でコピー**し、
  仕組みが「動いて見える」ことを確認する(口パクは僅かな差分でも可、無ければ同一でもフロー検証は可能)。
- **VRoid 本番素材**:VRoid Studio → VRoid Hub Photo Booth(チェッカー背景=透過)で
  表情/ポーズ/口開閉の PNG を書き出し、`sprites/` に置いて **animation.json を差し替えるだけ**で反映
  (コード変更不要=データ駆動)。

### 3. アニメ定義のロード(Character Layer)

```typescript
// src/character/loader.ts に追加(または animation-loader.ts)
// animation.json を読む。無ければ null(=単一 portrait フォールバック・F-ANIM-11)。
export async function loadCharacterAnimation(characterId: string): Promise<CharacterAnimation | null>;
```

- パスは `src/storage/paths.ts` 経由で `characters/{id}/animation.json` を解決。
- main の `getCharacterInfo()` を拡張し、**スプライトを base64 data URL 群**で Renderer に渡す
  (§4.2 N-08-1 と同じ理由:CSP/sandbox でディスク絶対パスを `<img src>` で読めない)。
  IPC 型 `CharacterInfo` に `animation?: { frames: Record<string,string /* dataURL */>; map; frameSize; timing }` を追加。

### 4. emotion フロー(Conversation Layer)

```typescript
// src/shared/types/conversation.ts
export interface ChatResponse {
  type: 'chat';
  message: string;
  emotion?: EmotionLabel;   // 追加(任意)
}
```

- **prompt-builder**:system の「出力形式」に emotion を追記。
  「`emotion` に次のいずれか1つを入れてよい:neutral/joy/anger/sorrow/surprise/embarrassed」。
  履歴 assistant ターンの JSON 化(N-09-8)もこの形に合わせる。
- **response-parser**:`emotion` を抽出。`EMOTION_LABELS` に無い/欠落 → `neutral`(フォールバック)。
  既存の三段構えパース・型ガードを維持(emotion は message と独立の任意フィールド)。
- **4層防御は不変**(emotion は AI 自称検知の対象外)。

### 5. スプライトレンダラ(`CharacterDisplay.tsx` 改修)

現行の forwardRef / `isOpaqueAt` / window 級ドラッグ / 右クリックは**維持**しつつ、表示を切り替える。

- props に `animation: CharacterAnimation(dataURL版)` と `state: CharacterState` を追加。
- **フレーム解決順**(純粋関数 `resolveFrame(animation, state, flapOpen)` に切り出し・単体テスト対象)。
  **重要:talking 中も emotion を保持する**(設計則③):
  1. `state.activity === 'thinking'` → `map.thinking`(無ければ `base.neutral`)
  2. `state.activity === 'talking'` → `flapOpen` なら `baseOpen[emotion]`(無ければ `base[emotion]`)、
     閉なら `base[emotion]` → 口だけが開閉し**表情は保持**される
  3. `state.activity === 'idle'` かつ `state.pose === 'sofa'` → `map.sofa`(無ければ `base.neutral`)
  4. `state.activity === 'idle'`(stand)→ `base[emotion]`(無ければ `base.neutral`、それも無ければ portrait)
- **位相と微動**:`mouthFlapMs` で口開閉トグル(talking 中のみ)、`idleSwayMs` で**呼吸=CSS transform の微小 Y 揺れ**
  (スプライト不要)。**まばたきは 0.2 では実装しない**。`setInterval`/`requestAnimationFrame` で flapOpen を駆動。
- **pose の制約**:`sofa` は **idle 専用**。thinking/talking に入る際は `pose='stand'` に戻す(話しかけたら起き上がる)。
- **canvas 再描画**:現在フレーム画像が変わるたび `drawToCanvas()` し直し、`isOpaqueAt` が**現フレームの alpha** を読む(F-ANIM-08)。

### 6. App 配線(`App.tsx`)

```typescript
const [charState, setCharState] = useState<CharacterState>({ activity: 'idle', emotion: 'neutral', pose: 'stand' });

async function handleSubmit(text: string): Promise<void> {
  setBubble(null);
  setInputVisible(false);
  setCharState(s => ({ ...s, activity: 'thinking' }));   // 考える間
  const response = await window.ene.sendMessage(text);
  const emotion = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
  setCharState(s => ({ ...s, activity: 'talking', emotion }));
  setBubble(response.message);
}
// 吹き出しが閉じたら(onClose / 自動消滅 / ESC)activity を idle に戻す。
```

- idle 滞在時間を計測し `SOFA_AFTER_IDLE_MS` 超で `pose: 'sofa'`、操作で `stand` に復帰。

### 7. クリック音(Web Audio で合成・外部アセットなし)

- **音は合成**する(外部ファイル・ライセンス確認・新 dir 不要)。`resources/sounds/` は作らない。
- Renderer に `playClick()`:`AudioContext`(遅延生成・1つ使い回し)で短いブリップを生成
  (例:`OscillatorNode` + `GainNode` の短いエンベロープ、または `AudioBuffer` のノイズバースト)。入力欄オープン・送信時に再生。
- 透明領域はクリックスルーで音を出さない(不透明部のクリックのみ)。
- "かわいい" CC0 サンプルへの差し替えは 1.1 の磨きで(その時は `resources/sounds/` 新設＋出典記録)。

### 8. テスト(`tests/unit/`・純粋ロジックのみ・vitest)

- `resolveFrame()` の解決順(thinking/sofa/talking-open/emotion/fallback)
- emotion パース・フォールバック(許可外/欠落 → neutral)
- animation.json のバリデーション(必須フィールド・未知フレーム名の無視)

> React コンポーネント自体は単体テストしない(N-08-7)。動作は `npm run dev` + スクショで代理検証。

---

## 受入チェックリスト

### 自動チェック(vitest / typecheck)

- [ ] `resolveFrame()` が状態に応じ正しいフレーム名を返す(各分岐)
- [ ] emotion パースが許可外/欠落で `neutral` を返す
- [ ] animation.json バリデーションが不正入力を安全に処理する
- [ ] TypeScript strict コンパイルが通る・ESLint 通過
- [ ] 既存テストが回帰しない

### 手動チェック(`npm run dev` + スクショ・人間判定)

- [ ] idle 中にまばたき/呼吸の微動が見える
- [ ] 長時間放置で稀に寝そべりになる(SOFA_AFTER_IDLE_MS)
- [ ] 送信後〜応答前に「考える」表示が出る(考える間)
- [ ] 応答表示中に口パクする
- [ ] 応答の emotion に応じて表情が変わる(6種を一通り)
- [ ] クリック音が入力欄オープン/送信時に鳴る
- [ ] クリックスルー/ドラッグ/右クリックが 0.1 同様に機能する(回帰なし)
- [ ] プレースホルダ素材でも破綻せず“動いて見える”
- [ ] **(成功基準8 連動)** 表情・間がキャラらしいか — **ユーザー手動判定**(`manual-check.md`)

---

## やってはいけないこと

- ❌ emotion を数値で蓄積(好感度・不機嫌度)— 1 ターン揮発ラベルのみ(§5.3)
- ❌ キャラ名・スプライト枚数・ラベル対応をコードにハードコード(animation.json/定数へ)
- ❌ 新規 npm ライブラリの追加(承認外・§2.3)
- ❌ Renderer で `fs` / Anthropic SDK を直接 import(IPC 経由・§4.1)
- ❌ ライセンス不明の音源・画像の同梱(無料配布可=CC0 等のみ)
- ❌ `isOpaqueAt` を現フレーム以外で判定(クリックスルーがずれる)
- ❌ ウィンドウの動的リサイズ(MVP 0.2 は 240×320 内に収める。寝そべりも枠内。動的リサイズは MVP 後・N-08-2 と同方針)
- ❌ 起動・終了・記憶など 0.1 の挙動を変更(本タスクは表示層に限定)

---

## 設計書への反映(承認後・implementation-notes 方針)

実装中の判断・差異は `docs/implementation-notes.md` に **N-13-x** として記録し、完了時にまとめて反映:

- `02_requirements.md`:**F-ANIM-01〜12** を追加
- `03_design.md`:§3.4 に `emotion?` フィールド、新章(アニメ状態機械・resolveFrame)、§11.5 の具体化、
  §2 ツリーに `characters/{id}/sprites/`・`animation.json`、§4.2 `CharacterInfo.animation`、§5.1 を「5 ファイル構成」へ
- `A_character_profile_samples.md`:animation.json サンプル追加

## 完了の定義

`npm run dev` で、**idle(まばたき/呼吸/稀に寝そべり)・送信中の考える間・応答中の口パク・
emotion に応じた表情切替・クリック音**が動作し、クリックスルー/ドラッグ/右クリックは 0.1 同様に機能する。
プレースホルダ素材でも破綻しない。**VRoid 本番素材は `sprites/` への配置と animation.json の差し替えのみ**で反映でき、
将来 0.3(音声リップシンク)は talking 状態の口パク駆動を差し替えるだけ、1.0(Live2D/VRM)は
`CharacterState` を実装する別レンダラへ差し替えるだけ、という土台が整っている。

---

## 付録:MVP 0.2 の素材・コンテンツ作業(非コード・本タスクのコードとは分離)

MVP 0.2「存在感」を完成させるには、上記コードに加え以下の**非コード作業**が要る。
コードはプレースホルダ(portrait 流用)で動くため、これらは**後から差し替え・追記**できる。
**MVP 0.2 のタスクはこの task_13 に集約**し、別タスク(task_14)は作らない。

### B-1. VRoid スプライト作成(ユーザーの手作業・コードでない)

VRoid Studio → VRoid Hub Photo Booth(チェッカー背景=透過)で約 14 枚の透過 PNG を書き出す:

- 表情 × 口:neutral / joy / anger / sorrow / surprise / embarrassed ×(口閉じ / 口開き)= 12 枚
- `thinking`(考え中の表情)1 枚、`sofa`(寝そべり・**240×320 枠内**)1 枚
- 命名は `animation.json` の `frames` に合わせる(例 `joy.png` / `joy_open.png`)。`characters/ene/sprites/` に配置。
- 完了後 `animation.json` を本番素材に差し替え(**コード変更不要**)。

### B-2. emotion few-shot 例の追加(JSON 設定のみ・コードでない)

- `characters/ene/fewshot.json` に、ENE 口調で「どの場面でどの感情を出すか」の応答例を追加。
- Claude が emotion を“キャラとして”選ぶ精度が上がる(prompt-builder は許可ラベルを渡すのみ)。

### C. 任意の JSON 精緻化(コードでない・0.2 必須ではない)

- 知識:`knowledge_domains.json` / `fewshot.json` のドメイン精緻化。
- 推論:`identity.json` / `fewshot.json` のキャラ口調・few-shot 拡充(**プロンプト構造の変更はしない**)。
- いずれも随時 JSON 編集で改善可能。0.2 のゲートにしない。

### 0.3 以降へ送り(コード・本タスク外)

- 記憶「会話への記憶活用を強化」(matchedTopic タグ検索 N-07-3 の改善等)は**コード作業**で、
  0.2 の存在感テーマと無関係なため **0.3 以降**で具体化する。

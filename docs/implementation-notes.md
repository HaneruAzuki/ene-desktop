# 実装ノート(設計書への反映待ちリスト)

> **このファイルの位置づけ**
> 実装(task_00〜)の過程で生じた **設計判断** と、判明した **設計書(01/02/03/別添A)の
> 不備・矛盾・曖昧さ** を記録する作業用ログ。
> プロジェクト完了時に、ここを見ながら設計書本体へまとめて反映する。
>
> - 即時に設計書本体を書き換えるのは、ユーザー承認が必要な変更(CLAUDE.md §2.5/§14)のうち
>   承認済みのものに限る(例: Node 20→24)。それ以外は本ファイルに記録して後でまとめて反映。
> - 各項目: 「タスク」「該当箇所」「内容」「採用した判断」「設計書へどう反映すべきか」。

---

## 凡例

- 🟢 **反映済み**: 既に設計書本体へ反映した(承認済みの変更)
- 🟡 **要反映**: 最後に設計書へ反映が必要
- ⚪ **判断記録のみ**: 設計書変更は必須でないが、判断の根拠として残す

---

## task_00(初期セットアップ)

### N-00-1 🟢 ランタイム Node.js 20 LTS → 24 LTS
- **該当**: 設計書 §1.2「技術スタック(確定)」開発時のみ / ランタイム
- **内容**: winget の `OpenJS.NodeJS.LTS` が 2026 時点で Node 24 系のみ提供し、20.x が入手不可。
- **判断**: ユーザー承認のうえ Node 24 LTS を採用。
- **反映**: §1.2 を「24 LTS」に更新済み(理由注記付き)。`@types/node` は Electron 30 同梱 Node(20系)に合わせ `^20` 固定。

### N-00-2 🟡 設定ファイル名の不一致(`.eslintrc.cjs`/`.prettierrc` vs `.json`)
- **該当**: 設計書 §2 ディレクトリツリー vs task_00 §5
- **内容**: §2 ツリーは `.eslintrc.cjs` / `.prettierrc`、task_00 §5 は `.eslintrc.json` / `.prettierrc.json` と記載。
- **判断**: SSOT である §2 ツリーを優先し `.eslintrc.cjs` / `.prettierrc` を採用(CLAUDE §11.1)。
- **反映**: task_00 §5 の記述を §2 に合わせて修正するか、両者の表記を統一する。

### N-00-3 🟡 React 用 Vite プラグインが §1.2 に無い
- **該当**: 設計書 §1.2(開発時のみ)
- **内容**: electron-vite で React(JSX)を扱うのに一般的な `@vitejs/plugin-react` が §1.2 に記載が無い。CLAUDE §2.3 によりライブラリ無断追加禁止のため未追加。
- **判断**: 追加せず、Vite の esbuild `jsx: 'automatic'` で JSX を変換(HMR/Fast Refresh は無し。MVP では問題なし)。
- **反映**: §1.2 に「React の JSX は esbuild で変換し、プラグインは追加しない」方針を明記。将来 Fast Refresh が必要なら `@vitejs/plugin-react` を承認のうえ追加する旨も併記。

### N-00-4 🟡 electron の dependencies 配置と electron-builder の慣習衝突(task_11 で要検証)
- **該当**: 設計書 §1.2 / CLAUDE §2.2(Electron は「同梱」=dependencies)
- **内容**: CLAUDE §2.2 と §1.2 は Electron を dependencies に分類。一方 electron-builder の一般的な慣習は electron を devDependencies に置く(dependencies にあると asar 同梱でビルドが肥大/失敗する懸念)。
- **判断**: 規約どおり dependencies に配置(task_00 時点で dev 起動・typecheck・lint は問題なし)。
- **反映**: **task_11(ビルド)でパッケージング検証**し、問題があれば「Electron は devDependencies、ただし配布物には含まれる(electron-builder がランタイムを同梱)」と分類定義を整理する案をユーザーに提示。§1.2/§2.2 の「同梱=dependencies」の定義に注記が必要かもしれない。

### N-00-5 🟡 task_00 提供の tsconfig.json に `lib` 指定が無い
- **該当**: task_00 §4 の tsconfig.json
- **内容**: 提示された tsconfig には `lib` 指定が無く、Renderer の DOM 利用(`document` 等)で `tsc --noEmit` が失敗する。
- **判断**: `"lib": ["ES2022","DOM","DOM.Iterable"]` と `"noEmit": true` を追加。
- **反映**: task_00 §4 の tsconfig 例に `lib` を追記。

---

## task_01(Storage Layer)

### N-01-1 🟡 `getMemoryDir()` 同期シグネチャ と active-character.json の非同期読込の矛盾
- **該当**: 設計書 §3.6 / §5.5(`getMemoryDir(): string` が active-character.json を参照)
- **内容**: §3.6 はパス関数を同期(`: string`)で定義しつつ「active-character.json の characterId を参照して動的に返す」とするが、ファイル読込は非同期 I/O(同期 I/O は CLAUDE §12 で禁止)。
- **判断**: characterId をモジュール内にキャッシュし、`refreshActiveCharacterId()`(非同期)で更新、`getMemoryDir()` 等の getter は同期でキャッシュ値を返す構成にした。`setActiveCharacterId()` も提供。
- **反映**: §3.6 に「characterId はキャッシュし、起動時に非同期で読み込んで反映、getter は同期」と実装方針を明記。

---

## task_02(Character Layer)

### N-02-1 🟡 型名・CharacterContext 構成の不一致(設計書 §3.1 vs タスク群)
- **該当**: 設計書 §3.1 の型定義 vs task_02〜10
- **内容**: §3.1 は `KnowledgeDomains` / `Fewshots` / `CharacterProfile` と、`CharacterContext { systemPrompt, fewshotMessages, birthdayHint }`。一方タスク群(02〜10)は `CharacterKnowledgeDomains` / `CharacterFewshot` と、リッチな `CharacterContext { identity, background, knowledgeDomains, fewshot, portraitPath, systemPrompt, birthdayHint }` を一貫使用。
- **判断**: 後続タスクが一貫参照するタスク群の型名・構成を採用。
- **反映**: 型の SSOT は設計書 §3(CLAUDE §11.2)なので、**§3.1 の型定義をタスク群の実装に合わせて更新**(名称・CharacterContext 構成・`CharacterProfile`/`LoadedCharacterProfile` の扱い)。

### N-02-2 🟡 JSON 応答形式指示の配置(buildSystemPrompt か Conversation Layer か)
- **該当**: task_02 §4.4 vs 設計書 §3.4
- **内容**: task_02 §4.4 は `buildSystemPrompt` に「応答形式(JSON)指示」を含めるとする。設計書 §3.4 のプロンプト構造は、出力形式を会話プロンプト構築(prompt-builder)側で付与する形。
- **判断**: 疎結合(CLAUDE §4.4)と §3.4 を優先し、`buildSystemPrompt` は人格・背景・知識境界・AI自称防止までとし、**JSON 応答形式は Conversation Layer(task_05)で付与**する設計にした。
- **反映**: task_02 §4.4 の「応答形式の指示」を Conversation Layer 側の責務として明記し直す。

### N-02-3 ⚪ `KnowledgeDomain.rationale` の必須/任意
- **該当**: 設計書 §3.1(`rationale?` 任意) vs task_02(`rationale` 必須)
- **内容**: §3.1 は任意、task_02 は必須。ENE の knowledge_domains.json は全ドメインに rationale を持つ。
- **判断**: task_02 に合わせ必須(`rationale: string`)。
- **反映**: §3.1 と task_02 の表記を統一(必須に寄せる想定)。

### N-02-4 ⚪ システムプロンプトから生の `gender` 出力を除外
- **該当**: 実装ポリッシュ(設計書変更は不要)
- **内容**: `gender: "female"` をそのまま日本語プロンプトに出すと「性別はfemale」と不自然。`ageAppearance: 少女` で十分伝わる。
- **判断**: プロンプト本文から生 gender 出力を除外(identity.json のデータは保持)。
- **反映**: 設計書変更は不要。必要なら identity.json の gender を日本語表現にする案もあるが現状維持。

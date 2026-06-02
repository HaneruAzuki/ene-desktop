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

---

## task_03(Memory Layer)

### N-03-1 🟡 検索クエリの型名・フィールド差(`MemorySearchQuery` vs 設計書 §3.3 `SearchQuery`)
- **該当**: 設計書 §3.3 `SearchQuery { tags, category, minImportance, fromDate, limit }` vs task_03 `MemorySearchQuery { tags, category, minImportance, yearFrom, yearTo, limit }`
- **内容**: 型名が異なり、日付フィルタが「fromDate(単一)」→「yearFrom/yearTo(年範囲)」に変わっている。
- **判断**: task_03 の `MemorySearchQuery`(年範囲)を採用。Episodic がキャラ別の {year} ディレクトリ階層を持つため、年フィルタの方が全走査と相性が良い。
- **反映**: §3.3 の型名を `MemorySearchQuery` に統一し、日付フィルタを年範囲(yearFrom/yearTo)に更新。

### N-03-2 🟡 `MemoryContext` のフィールド名・並び差
- **該当**: 設計書 §3.3 `MemoryContext { shortTerm, semantic, episodic }` vs task_03 `{ semantic, shortTerm, relevantEpisodic }`
- **内容**: `episodic` → `relevantEpisodic`(検索結果であることを明示)。
- **判断**: task_03 を採用。
- **反映**: §3.3 の `MemoryContext` を `relevantEpisodic` に更新。

### N-03-3 🟡 短期記憶 API の差(`trimShortTerm` → 複数 API)
- **該当**: 設計書 §3.3 `getShortTerm/appendShortTerm/trimShortTerm` vs task_03
- **内容**: task_03 は `clearShortTerm` / `getUnextractedEntries` / `markAsExtracted` を持ち、`trimShortTerm` 単体は持たない(トリムは appendShortTerm 内部で行う)。`saveSemantic` も追加。
- **判断**: task_03 の関数群を採用。
- **反映**: §3.3 の関数シグネチャ一覧を task_03 の構成へ更新。

### N-03-4 🟡 記憶抽出の Claude 呼び出しを依存性注入(DI)に / `characterContext` を省略
- **該当**: 設計書 §3.3 / task_03 §5・§6 の extractor / extraction-trigger
- **内容**:
  - task_03 のシグネチャは `extractMemoryFromConversation(entries, characterContext)` だが、抽出は「中立的観察者」でキャラ非依存(task_03 自身が明記)。よって `characterContext` を引数から省略した。
  - 代わりに Claude 呼び出しを `LlmComplete`(`(req)=>Promise<string>`)として注入する設計にした。これにより **task_03 が task_05(Conversation Layer の Claude クライアント)へ前方依存しない**。保存先キャラは paths.ts のキャッシュ済み characterId で解決されるため characterContext は不要。
  - `LlmComplete` 型は暫定的に `src/memory/extractor.ts` に置いた(将来 §11.7 の `src/llm/types.ts` へ移す想定)。
- **判断**: DI + characterContext 省略。
- **反映**: §3.3 の extractor シグネチャを「未抽出エントリ + LLM 呼び出し関数(注入)」に更新。characterContext は不要と明記。LLM 抽象の置き場所(§11.7)に言及。

### N-03-5 🟡 `appendShortTerm` の overflow 抽出をコールバック注入に
- **該当**: task_03 §2(「20件超過時に抽出処理を呼んでからトリム」)
- **内容**: short-term.ts が直接 extraction-trigger(→ Claude)を import すると前方依存・密結合になる。`appendShortTerm(entry, onOverflow?)` の形で overflow 時の抽出処理を注入する設計にした。Conversation Layer/起動統合が `onOverflow = () => extractFromShortTerm('overflow', complete)` を渡す。
- **判断**: コールバック注入。
- **反映**: §3.3 に「appendShortTerm は overflow ハンドラを受け取り、Memory 層は Claude へ直接依存しない」と明記。

### N-03-6 🟡 Episodic ファイル名は `memory.date` から導出(`nowLocalIsoForFilename()` ではなく)
- **該当**: task_03 §4(「filename は nowLocalIsoForFilename() を使う」) vs 設計書 §5.2 の例
- **内容**: §5.2 の例ではファイル名が `date` フィールドと一致(`2026-05-10T17-30-00.json` ↔ date `2026-05-10T17:30:00+09:00`)。`nowLocalIsoForFilename()`(=現在時刻)を使うと、ディレクトリ年(date由来)とファイル名年がズレうる。
- **判断**: `memory.date` から TZ を除き `:`→`-` 置換してファイル名を導出(§5.2 と一致)。なお date は抽出時に `nowLocalIso()` で付与するため実質現在時刻。
- **反映**: task_03 §4 を「filename は memory.date から導出」に修正。

### N-03-7 🟡 `validateSemantic` はコア型不一致を「無視」(例外を投げない)
- **該当**: 設計書 §3.3 擬似コード(無視) vs task_03 §3 コメント(「コア違反は例外」)
- **内容**: 2 箇所で方針が食い違う。壊れた semantic.json で例外を投げると記憶読込で会話が止まる(NF-REL-02「Memory読込失敗時も会話継続」に反する)。
- **判断**: 設計書 §3.3 擬似コードに従い、型不一致のコアフィールドは無視して採用しない(例外なし)。version は既定 1。
  - なお design §3.3 は「ログに警告」も求めるが、検証器を純粋関数に保つため警告ログは未実装(必要なら呼出側で対応)。
- **反映**: task_03 §3 の「コア違反は例外」を「無視(継続性優先)」に統一。警告ログの要否を明記。

### N-03-8 ⚪ 記憶定数を `src/shared/constants.ts` に配置
- **該当**: 設計書 §2(`src/shared/constants.ts` が存在)
- **内容**: `SHORT_TERM_MAX_ENTRIES=20` ほか記憶系定数を constants.ts に集約。
- **判断**: 設計書 §2 のファイルに沿って配置。
- **反映**: 設計書変更は不要。

---

## task_04(Knowledge Router)

### N-04-1 🟡 `RouterResult` 型(task_04) vs 設計書 §3.2 `RoutingResult`
- **該当**: 設計書 §3.2 `RoutingResult { topic, domain, behavior, fewshotKey }` vs task_04 `RouterResult { domain, behavior, fewshotKey, matchedTopic?, isFromCache, isFromFallback }`
- **内容**: 型名が異なり、`topic` が `matchedTopic?` に、キャッシュ/フォールバック由来フラグが追加。
- **判断**: task_04 の `RouterResult` を採用(キャッシュ/フォールバック可視化のため有用)。
- **反映**: §3.2 の型を `RouterResult` に統一(`isFromCache`/`isFromFallback`/`matchedTopic` を反映)。

### N-04-2 🟡 Haiku 呼び出しを DI 可能に(任意4番目引数)
- **該当**: task_04 §3 `classifyTopic(userText, knowledgeDomains, apiKey)`
- **内容**: テスト容易性のため、任意4番目引数 `llmCall: RouterLlmCall`(既定=実 Haiku 呼び出し)を追加。これで実 API なしで成功/タイムアウト/失敗/キャッシュを単体テスト可能。
- **判断**: 公開シグネチャは維持しつつ DI 用の任意引数を追加。
- **反映**: §3.2 に「LLM 呼び出しは差し替え可能(テスト/将来のマルチプロバイダ §11.7)」と注記。

### N-04-3 🟡 判定プロンプトからキャラ名 `{name}` を省略
- **該当**: task_04 §「判定プロンプトの構造」(冒頭が「キャラクター{name}」)
- **内容**: `classifyTopic` は `knowledgeDomains` のみ受け取り `identity.name` を持たない。判定は topics で決まり名前は装飾的なので、「あるキャラクターの知識範囲を判定」と中立表現にした。
- **判断**: 名前を使わない表現に。
- **反映**: task_04 のプロンプト例から `{name}` 依存を外すか、必要なら identity/characterId を引数に追加する旨を明記。

### N-04-4 ⚪ Router 定数の配置
- **該当**: task_04(`ROUTER_TIMEOUT_MS=800` / `ROUTER_CACHE_SIZE=10`)
- **内容**: `ROUTER_TIMEOUT_MS` と `ROUTER_MODEL` は router.ts、`ROUTER_CACHE_SIZE` は cache.ts に定義(タスク記載どおり)。
- **判断**: タスク記載に沿う。
- **反映**: 設計書変更は不要(必要なら constants.ts への集約を検討)。

---

## task_05(Conversation Layer)

### N-05-1 🟡 `OsAction`/`OsCommand` の定義場所
- **該当**: task_05 §1(conversation.ts に定義) vs 設計書 §3.4(「OsCommand は src/shared/types/os.ts で定義」)
- **内容**: task_05 §1 は OsAction/OsCommand を conversation.ts に書いているが、設計書 §3.4 は os.ts を指す。task_06 でも os.ts が必要。
- **判断**: 設計書 §3.4 に従い `src/shared/types/os.ts` に定義(OsCommandResult も)。conversation.ts は import。重複回避。
- **反映**: task_05 §1 の型配置を os.ts 参照に修正。

### N-05-2 🟡 Sonnet 呼び出し・トークンチェックを DI 可能に
- **該当**: task_05 §7 `chat(userText, charContext, memoryContext, routerResult, apiKey)`
- **内容**: テスト容易性のため任意6番目引数 `deps?: Partial<ChatDeps>`(`callModel` / `checkTokens`)を追加。実 API なしで4層防御フローを単体テスト可能。
- **判断**: 公開シグネチャ維持 + DI 用任意引数。
- **反映**: §3.4 に「LLM 呼び出しは差し替え可能」と注記。

### N-05-3 🔴 **重要**: SDK ^0.30.x に `messages.countTokens` が無い → ローカル見積もりに変更
- **該当**: 設計書 §3.4「トークン数計測の実装方針」(`client.messages.countTokens` 使用)/ token-counter.ts
- **内容**: 固定中の `@anthropic-ai/sdk@^0.30.x` には countTokens API が存在しない(後発版で追加)。`countAndCheck(client, request)` がコンパイル不能。
- **判断**: SDK 更新はバージョン規約(CLAUDE §2.4・^0.30 を超える)上ユーザー承認が要るため、MVP では **ローカルの簡易トークン見積もり**(`CHARS_PER_TOKEN=2.5`)でガードレールを実装。`countAndCheck` のシグネチャを `(prompt: BuiltPrompt) => TokenCheck` に変更。
- **反映(要判断)**: 次のいずれか。(a) 厳密計測が必要なら `@anthropic-ai/sdk` を countTokens 対応版へ更新(§1.2 を承認のうえ変更)、(b) MVP は見積もりで十分として §3.4 を「ローカル見積もり」に更新。**ユーザー判断が必要**。

### N-05-4 🟡 messages の交互列正規化(`normalizeAlternation`)を追加
- **該当**: 設計書 §3.4 の messages 構造
- **内容**: Claude Messages API は role が user/assistant で交互・先頭 user である必要がある。few-shot + 短期記憶 + 現在入力を素朴に並べると連続同 role が生じうる。
- **判断**: prompt-builder で連続同 role を結合し先頭を user に揃える正規化を追加(その後に Prefill の assistant "{" を付与)。
- **反映**: §3.4 に「messages は交互列に正規化する」と明記。

### N-05-5 ⚪ 出力形式(JSON 仕様)は prompt-builder が付与(N-02-2 の帰結)
- **該当**: 設計書 §3.4 / task_02 §4.4(N-02-2)
- **内容**: JSON 応答形式は buildSystemPrompt(キャラ層)ではなく prompt-builder(会話層)で system に付与する、という N-02-2 の判断をここで実装。
- **判断**: 出力形式は会話層に集約(疎結合)。
- **反映**: N-02-2 と合わせて §3.1/§3.4 を整理。

### N-05-6 ⚪ 誕生日 'forgotten' の few-shot 注入
- **該当**: task_05 §3(system は 'today' のみ言及)/ 設計書 §3.1(forgotten 反応)
- **内容**: birthdayHint が 'forgotten' の場合も、messages に forgotten 用 few-shot を1例注入する(today は祝福 few-shot + system 注記)。
- **判断**: today/forgotten 双方を few-shot で表現(感情パラメータは持たない方針と整合)。
- **反映**: §3.4 の messages 構造に forgotten ケースも明記。

---

## task_06(OS Integration Layer)

### N-06-1 🟡 `OsCommandResult` の形(設計書 §3.5 vs task_06 §1)
- **該当**: 設計書 §3.5 `OsCommandResult { success, message?, error? }` vs task_06 §1 `{ ok, message?, reason? }`
- **内容**: 設計書は success/error、task_06 は ok と理由 enum(`invalid_action|invalid_target|path_traversal|outside_home|non_https|exec_error`)+ FALLBACK_MESSAGES。
- **判断**: task_06 の `{ ok, message?, reason? }` を採用(理由別フォールバック文言が扱いやすい)。task_05 で作った os.ts を更新(consumer 未生成のため安全)。
- **反映**: §3.5 の OsCommandResult を ok/reason ベースに更新。executor は失敗時に reason → キャラ口調 message を付与。

### N-06-2 ⚪ OsAction/OsCommand の import 元
- **該当**: task_06 §1(`import { OsAction, OsCommand } from "./conversation"`)
- **内容**: N-05-1 で OsAction/OsCommand を os.ts に置いたため、OsCommandResult と同じファイル内。conversation からの import は不要。
- **反映**: task_06 §1 の import 記述を os.ts 内定義に合わせる。

### N-06-3 ⚪ child_process の import 指定子
- **該当**: task_06 §2(`from "child_process"`)
- **内容**: `from 'node:child_process'` を使用(モダンな node: プレフィックス)。`shell:true` は使わず引数配列固定。
- **反映**: 設計書変更不要。

---

## task_07(Electron Main Process)

### N-07-1 🟡 設計書 §2 の main/ ツリーに無いファイルを追加
- **該当**: 設計書 §2(main/ は index/window/tray/ipc/lifecycle のみ)
- **内容**: 実装で `src/main/` に `window-position.ts`(task_07 §4)・`character-context-menu.ts`(task_07 §6)・`single-instance.ts`(task_01/§8)・`api-key-dialog.ts`(task_07 §6 スタブ/§3.7)を追加。設計書 §2 ツリーには未記載。
- **判断**: タスク仕様に従い追加。
- **反映**: 設計書 §2 の main/ ツリーにこれらのファイルを追記。

### N-07-2 🟡 起動シーケンスの一部(charContext/apiKey ロード)を task_07 で実施
- **該当**: task_07 §9(「起動シーケンス全体は task_10」)/ 設計書 §7.1
- **内容**: IPC(get-character-info / send-message)を機能させるため、index.ts で `buildCharacterContext()` と `loadAndDecryptApiKey()` の最小ロードを実施。クラウド警告・APIキーダイアログ・誕生日チェック・挨拶などの残りは task_10。
- **判断**: 動作に必要な最小サブセットのみ先行実施(失敗しても起動継続)。
- **反映**: §7.1 の起動シーケンスで「どこまでが task_07 / task_10 か」を整理(本質的な変更ではない)。

### N-07-3 🟡 send-message の記憶検索は matchedTopic をタグに使う簡易検索
- **該当**: 設計書 §3.4 / §3.3(関連中期記憶の検索)
- **内容**: IPC の send-message で `buildMemoryContext({ tags: matchedTopic ? [matchedTopic] : undefined, limit: 5 })` を使用。意味的関連ではなく簡易タグ一致(MVP・ベクトル検索は §11.4 で将来)。
- **判断**: MVP のタグ検索方針に沿う簡易実装。
- **反映**: §3.4 に「会話時の Episodic 検索クエリの組み立て方(MVP は matchedTopic タグ)」を明記。

### N-07-4 ⚪ `makeLlmComplete(apiKey)` を conversation/client.ts に追加
- **該当**: 設計書 §3.3(extractor の LlmComplete 注入)
- **内容**: 記憶抽出(overflow / 終了時)へ渡す Claude 呼び出しを生成するファクトリ。Sonnet を使用。
- **判断**: extractor の DI(N-03-4)を満たす実体を会話層に置く。
- **反映**: §3.3/§3.4 に LlmComplete の実体の置き場所を明記。

### N-07-5 ⚪ `createMainWindow(position?)` に任意引数
- **該当**: task_07 §3(`createMainWindow(): BrowserWindow`)
- **内容**: ウィンドウ位置の読込が非同期のため、index.ts で位置を解決してから `createMainWindow(position)` に渡す形にした。
- **反映**: §8.1 のシグネチャに任意 position 引数を反映。

### N-07-6 🟡 **task_11 注意**: resources/ がパッケージに含まれていない
- **該当**: electron-builder.yml の `files`(`out/**` と `characters/**` のみ)/ tray アイコン
- **内容**: トレイアイコン等は `resources/` 配下だが、現状の electron-builder.yml は resources を同梱対象にしていない。dev では `app.getAppPath()/resources` で解決できるが、本番パッケージでアイコンが見つからない恐れ。
- **判断**: dev は動作。本番同梱は task_11 で対応。
- **反映**: **task_11 で `extraResources`(または files に resources/**)を追加**してアイコンを同梱する。

### N-07-7 ⚪ window-all-closed → app.quit()
- **該当**: task_07 §9
- **内容**: タスクトレイ常駐アプリだが、task_09 §9 どおり window-all-closed で quit。実際にはウィンドウは hide 運用で close されないため、主に安全網。
- **反映**: 設計書変更不要。

---

## task_08(Renderer UI)

### N-08-1 🟡 `getCharacterInfo` は portrait を data URL で返す(portraitPath → portraitUrl)
- **該当**: 設計書 §4.2 `getCharacterInfo(): { name, portraitPath }`
- **内容**: Renderer は CSP(`img-src 'self' data:`)+ sandbox のため、ディスク絶対パスを `<img src>` で読めない。main 側で portrait.png を読み base64 data URL 化して返すよう変更(`CharacterInfo.portraitUrl`)。
- **判断**: data URL 化。
- **反映**: §4.2 の `CharacterInfo` を `portraitUrl`(data URL)に更新。

### N-08-2 🔴 **要判断**: ウィンドウ 240×320 と吹き出し最大 400px の衝突
- **該当**: 設計書 §8.1(window 240×320)/ §8.5(bubble max 400px)
- **内容**: 240×320 のウィンドウ内に最大 400px の吹き出しは収まらない。吹き出し/入力欄はウィンドウ DOM 内に描画されるため、はみ出すと窓にクリップされる。
- **判断(MVP)**: 吹き出しは上部・入力欄は下部にオーバーレイ配置し、`max-height: min(400px, calc(100vh - 90px))` でウィンドウ高に収める(キャラに重なる)。
- **反映(要判断)**: (a) ウィンドウを大きくして吹き出し用スペースを確保(§8.1 変更・承認要)、(b) 吹き出し表示時にウィンドウを動的リサイズ(IPC 追加)、(c) MVP のオーバーレイで許容、のいずれか。**ユーザー判断が必要**。

### N-08-3 🟡 move-window の位置保存をデバウンス
- **該当**: task_07 §7(move-window で毎回 saveWindowPosition)
- **内容**: ドラッグ中に毎フレーム JSON 保存すると過剰 I/O。setBounds は即時、保存は 400ms デバウンスに変更。Renderer 側は requestAnimationFrame で moveWindow をスロットル。
- **反映**: §8.3 に「ドラッグ中の保存はデバウンス」と明記。

### N-08-4 🟡 クリックスルー判定を App に集約(window mousemove)
- **該当**: 設計書 §8.6
- **内容**: 「キャラ不透明 OR 吹き出し OR 入力欄」の判定を App の window 級 mousemove で一元化。CharacterDisplay は `useImperativeHandle` で `isOpaqueAt(x,y)` を公開。値が変わった時のみ `setIgnoreMouseEvents` を呼ぶ(IPC 削減)。
- **反映**: §8.6 の実装方針に集約版を反映。

### N-08-5 ⚪ ドラッグは window 級 mousemove/mouseup で追従
- **該当**: 設計書 §8.2(img の onMouseMove 例)
- **内容**: 取りこぼし防止のため mousedown 時に window へ move/up を登録(同一クロージャで removeEventListener)。rAF スロットル + デバウンス保存。
- **反映**: §8.2/§8.3 に補足。

### N-08-6 ⚪ スタイル/エントリのパス
- **該当**: task_08 §6/§7(styles.css)
- **内容**: 既存配線に合わせ `src/renderer/styles/global.css` を使用(設計書 §2 のツリーと一致)。main.tsx は既存のまま。
- **反映**: 設計書変更不要。

### N-08-7 ⚪ React コンポーネントは単体テストせず dev 起動で検証
- **該当**: 設計書 §1.2 / §10
- **内容**: @vitejs/plugin-react / React Testing Library / jsdom を追加していない(§1.2 外・N-00-3)。コンポーネントは `npm run dev` + スクショで代理検証し、純粋ロジック(mouse-gesture)のみ単体テスト。インタラクション系はユーザーの手動確認。
- **反映**: §10 のテスト戦略に「Renderer は手動 + 純粋ロジックのみ自動」と明記。

---

## task_09(APIキー管理ダイアログ)

### N-09-1 🟡 `api-key-dialog-ipc.ts` を `api-key-dialog.ts` に統合
- **該当**: task_09 §6(別ファイル `api-key-dialog-ipc.ts`)
- **内容**: ダイアログのモジュール状態(現在のウィンドウ・onSaved・close 結果)を共有する必要があるため、IPC 登録(test/save/open-console/close)を `api-key-dialog.ts` に統合。グローバルハンドラは一度だけ登録(再登録エラー回避)。
- **反映**: task_09 §6 の配置を統合版に合わせる。

### N-09-2 🟡 electron-vite をマルチエントリ化(ダイアログ用 2nd renderer/preload)
- **該当**: 設計書 §1.3 / electron.vite.config.ts
- **内容**: ダイアログ専用ページ(`src/renderer/api-key-dialog/`)と専用 preload を持つため、renderer/preload の rollupOptions.input を 2 エントリに拡張。dev は `${ELECTRON_RENDERER_URL}/api-key-dialog/index.html` を読込。ビルド成功・ダイアログ表示を確認済み。
- **反映**: §1.3/§9 に「マルチエントリ構成(メインUI + APIキーダイアログ)」を明記。

### N-09-3 🟡 Renderer から `getErrorMessage` を import / `isValidKeyFormat` はインライン
- **該当**: task_09 §4/§5(api-key-tester / api-key-error-messages)
- **内容**: `api-key-tester.ts` は Anthropic SDK を import するため、Renderer から読むと SDK がダイアログバンドルに混入する。形式チェックはダイアログ内にインライン化(SDK 非混入・バンドル 4.2KB を確認)。`getErrorMessage`(純粋・SDK 非依存)のみ Renderer から import。
- **反映**: §3.7 に「形式チェックは Renderer 内、疎通テストは main(SDK)」と分離を明記。

### N-09-4 🟡 キー失効の自動再表示は `chat()` の onAuthError コールバックで配線
- **該当**: task_09 §7 / 設計書 §6.1
- **内容**: 層の疎結合を保つため、`chat()` に任意 `onAuthError(error)` を追加(401/402/429 検知時に呼ぶ・electron 非依存)。main 側(send-message IPC)が onAuthError でダイアログを再表示し、保存後 runtime.apiKey を更新する。Router(classifyTopic)へは未配線(同じ失効は chat 呼び出しでも顕在化するため)。
- **反映**: §3.4/§6.1 に「auth エラーはコールバックで main へ通知」と明記。

### N-09-5 🟡 F-KEY-03(起動時自動表示)を task_09 で実装(完全な起動列は task_10)
- **該当**: task_09 §8 / 要件 F-KEY-03
- **内容**: APIキー未保存時に起動時ダイアログを表示する処理を index.ts に追加(ダイアログを実際に到達可能にするため)。キャンセル時終了・クラウド警告・挨拶などの完全な起動シーケンスは task_10。
- **反映**: §7.1 の起動シーケンスで task_09/task_10 の境界を整理。

### N-09-6 ⚪ ダイアログ窓の磨き(メニュー除去・中央配置)
- **該当**: 実装ポリッシュ
- **内容**: frame:true のダイアログに既定メニューバーが出るため `win.removeMenu()`、`win.center()` で中央配置。
- **反映**: 設計書変更不要。

### N-09-7 🔴 **重要(不具合修正)**: 現行モデルは assistant メッセージ Prefill 非対応 → Prefill 廃止
- **該当**: 設計書 §3.4「JSON出力強制の実装方針(Prefill 方式)」/ §3.2 / §2.5 F-CONV-06
- **症状**: 実機検証で全質問にフォールバック「…ごめん、なんか調子悪いみたい」。ログは `conversation model call failed`。
- **原因**: `claude-sonnet-4-6`(および Haiku 4.5 等の現行 Claude 4.x)は、末尾を assistant メッセージ(`{role:'assistant', content:'{'}`=Prefill)にすると **400 invalid_request_error: "This model does not support assistant message prefill. The conversation must end with a user message."** を返す。設計書の Prefill 方式がそのまま使えない。
  - 切り分け: モデル ID `claude-sonnet-4-6` 自体は有効(単純メッセージは 200)。Prefill 付き(実 buildPrompt 構造)で 400。
- **判断**: **Prefill を廃止**(会話・Router 双方)。会話は末尾を user メッセージで終える。JSON は「system プロンプトの強い指示(JSON 1個のみ・前後に文章を付けない)+ 三段構えパーサ(フェンス除去・`{...}`抽出)」で担保。実機で応答が `{` 始まりのクリーン JSON・`chat` としてパース成功を確認。
- **反映(要)**: §3.4 の Prefill 方式・F-CONV-06、§3.2 の Router Prefill、`prompt-builder`/`client`/`router` のコード例から Prefill を削除し、「現行モデルは prefill 非対応。出力安定化は system 指示 + ロバストパーサで行う」に更新。必要なら将来 tool 出力(structured output)方式も検討。
- **有効なモデル ID(2026-06 時点・このキーで確認)**: `claude-sonnet-4-6` / `claude-sonnet-4-5`(alias)/ `claude-sonnet-4-5-20250929` / `claude-haiku-4-5-20251001` / `claude-haiku-4-5`。無効(404): `claude-3-7-sonnet-20250219`、`claude-3-5-sonnet-20241022` 等の旧世代。

### N-09-8 🔴 **重要(不具合修正)**: プロンプト内の assistant ターンを JSON 形式に統一(履歴でプレーン文を学習しパース失敗)
- **該当**: 設計書 §3.4 の messages 構造(few-shot / 短期記憶)
- **症状**: 数ターン会話した後、特に「パチンコの新台教えて」等で `…ごめん、なんか調子悪いみたい` が再発。空メモリでは成功、実メモリ(短期20件)で失敗。
- **原因**: few-shot と短期記憶の **assistant メッセージをプレーン文のまま渡していた**。短期記憶には ENE の過去応答(=message 本文・プレーン)が並ぶため、モデルが履歴のスタイルを真似て **JSON ではなくプレーン文で返す** → `parseConversationResponse` が null → フォールバック(この経路はログに出ない)。少数の few-shot だけなら system の JSON 指示が勝つが、20件の履歴があると履歴側が勝つ。
- **判断**: prompt-builder で **assistant ターン(few-shot・誕生日・短期記憶)を `{"type":"chat","message":"..."}` の JSON 形式で提示**し、履歴と出力形式を一致させた(`assistantTurn()`)。user ターンはプレーンのまま。実メモリ込みで `parsed=chat` に回復。
- **反映(要)**: §3.4 の messages 例で「assistant ターンは出力形式(JSON)で提示する」を明記。
- **教訓**: in-context の実例(履歴)は system 指示より強く効く。出力フォーマットを使う場合、履歴の assistant 側もそのフォーマットで提示すること。

### N-09-9 🟡 Router の 800ms タイムアウトが実 Haiku レイテンシ(約1.5–2.5s)を下回り、毎回 fallback
- **該当**: 設計書 §3.2 / NF-PERF-03(ROUTER_TIMEOUT_MS=800)
- **内容**: 実機ログで `Router fallback used: domain=medium` が毎回。Haiku の往復が 800ms を超えるため、Router は実質的に常に fallback=medium になる。トピック判定が効かず、ドメイン別 few-shot(例: none/unknown_none)が使われない。
- **緩和されている点**: キャラの知識境界(高校生が知らない領域=パチンコ等で自然に「知らない」)は **buildSystemPrompt(system)に含まれている**ため、medium 扱いでも ENE は「知らない」と返せる(成功基準4は system 側で担保)。診断でも確認済み。
- **判断/反映(要検討)**: 次のいずれか。(a) タイムアウトを ~2000ms へ引き上げる(総応答が NF-PERF-02 の 3–5s を超えうる)、(b) Router を memory 構築と並列実行してレイテンシ吸収、(c) 現状の best-effort(fallback)を許容し Router を補助的位置づけのままにする。MVP は (c) で動作。**MVP 完成後にブラッシュアップ**(ユーザー方針)。

### N-09-10 🟡 記憶抽出が毎メッセージ発火(短期20件超過後)→ コスト/レイテンシ増
- **該当**: 設計書 §3.3「短期記憶の保持と抽出トリガ」/ short-term.ts の overflow
- **内容**: 短期記憶が20件に達すると、以降は**メッセージごとに** overflow 抽出(`extractFromShortTerm('overflow')`)が走る。毎回 1 件だけを抽出するため、メッセージごとに抽出用の追加 Sonnet 呼び出しが発生し、コスト・レイテンシが増える。実機ログで毎メッセージ `memory extraction triggered: reason=overflow, entries=1` を確認。
- **動作上の問題**: なし(記憶は正しく抽出・記録される)。効率の問題のみ。
- **改善案(MVP後)**: (a) 未抽出が一定件数(例: 5–10)たまった時のみ抽出、(b) overflow 抽出をデバウンス/バッチ化、(c) 抽出をバックグラウンドキューに載せて会話レイテンシから切り離す。
- **判断**: MVP は現状で動作。**MVP 完成後にブラッシュアップ**(ユーザー方針)。

---

## 🔧 MVP 完成後のブラッシュアップ予定(機能・品質改善)

MVP の動作自体は妨げないが、完成後に改善する項目(ユーザー方針で記録)。

- **[N-09-9] Router タイムアウト**: 800ms が実 Haiku レイテンシを下回り毎回 fallback。並列化 or タイムアウト調整を検討。
- **[N-09-10] 記憶抽出の頻度**: 短期20件超過後は毎メッセージ抽出 → 追加 API 呼び出し。一定件数たまった時のみ/バッチ化/バックグラウンド化を検討。
- (随時追記)

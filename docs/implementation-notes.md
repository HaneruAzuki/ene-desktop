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

# 実装ノート(設計書への反映待ちリスト)

> ## ✅ 設計書反映 完了(2026-06-03)
> 本ファイルの **🟡 要反映** 項目は、ユーザ承認のうえ `docs/03_design.md` に一括反映済み。
> 反映先(主な対応):§1.2(JSX/esbuild・N-00-3)、§1.3/§2(マルチエントリ・main ファイル群・N-09-2/N-07-1)、
> §3.1(型名 CharacterKnowledgeDomains/CharacterFewshot・rationale 必須・リッチな CharacterContext・N-02-1/3)、
> §3.2(RouterResult・classifyTopic DI・Prefill 廃止・N-04-1/2/3・N-09-7)、
> §3.3(MemorySearchQuery・relevantEpisodic・短期 API・抽出 DI・N-03-1〜7)、
> §3.4(ローカルトークン見積もり・Prefill 廃止・履歴 JSON 化・normalizeAlternation・onAuthError・N-05-2/3/4/5/6・N-09-4/7/8)、
> §3.5(OsCommandResult ok/reason・N-06-1)、§3.6(characterId キャッシュ・PORTABLE_EXECUTABLE_DIR・N-01-1/N-11-2)、
> §3.7(IPC 統合・SDK 分離・N-09-1/3)、§4.2(portraitUrl data URL・getInitialGreeting・N-08-1/N-10-3)、
> §6.1(onAuthError)、§7.1(runtime 集約・N-07-2/N-09-5/N-10-1)、§8.1/8.3/8.6/8.7(position 引数・吹き出し許容・
> デバウンス保存・クリックスルー集約・pull 挨拶・N-07-5/N-08-2/3/4/5/N-10-3/5)、§10(受入テスト方針・N-08-7/N-12-1/2)、§11.7(Prefill 注記)。
> ⚪ 項目は「設計書変更不要」のため対象外。各項目の 🟡 マークは履歴として残置(上記のとおり反映済み)。
> なお task ファイル側の表記ゆれ(N-00-2/N-00-5 等)は歴史的資料として未編集。
> **MVP後ブラッシュアップ予定**(N-09-9/10・N-11-1/4・N-12-4 等)は `docs/optimization-backlog.md` へ移動した(2026-06 整理)。
>
> 📂 **2026-06 ドキュメント整理**:マージ済みの改訂文書(`design-revision-memory-v2` /
> `-character-heart` / `-voice`)と canon ドラフトは `docs/archive/` へ移動した。
> 以下の N-xx に出てくる `design-revision-*` への言及は経緯記録であり、現行の所在は
> `docs/archive/README.md` の対応表を参照(現行 SSOT は `03_design.md`)。

> **このファイルの位置づけ**
> 実装(task_00〜)の過程で生じた **設計判断** と、判明した **設計書(01/02/03/別添A)の
> 不備・矛盾・曖昧さ** を記録する作業用ログ。
> プロジェクト完了時に、ここを見ながら設計書本体へまとめて反映する。
>
> - 即時に設計書本体を書き換えるのは、ユーザ承認が必要な変更(CLAUDE.md §2.5/§14)のうち
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
- **判断**: ユーザ承認のうえ Node 24 LTS を採用。
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
- **反映**: **task_11(ビルド)でパッケージング検証**し、問題があれば「Electron は devDependencies、ただし配布物には含まれる(electron-builder がランタイムを同梱)」と分類定義を整理する案をユーザに提示。§1.2/§2.2 の「同梱=dependencies」の定義に注記が必要かもしれない。

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
- **判断**: SDK 更新はバージョン規約(CLAUDE §2.4・^0.30 を超える)上ユーザ承認が要るため、MVP では **ローカルの簡易トークン見積もり**(`CHARS_PER_TOKEN=2.5`)でガードレールを実装。`countAndCheck` のシグネチャを `(prompt: BuiltPrompt) => TokenCheck` に変更。
- **反映(要判断)**: 次のいずれか。(a) 厳密計測が必要なら `@anthropic-ai/sdk` を countTokens 対応版へ更新(§1.2 を承認のうえ変更)、(b) MVP は見積もりで十分として §3.4 を「ローカル見積もり」に更新。**ユーザ判断が必要**。

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
- **反映(要判断)**: (a) ウィンドウを大きくして吹き出し用スペースを確保(§8.1 変更・承認要)、(b) 吹き出し表示時にウィンドウを動的リサイズ(IPC 追加)、(c) MVP のオーバーレイで許容、のいずれか。**ユーザ判断が必要**。

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
- **内容**: @vitejs/plugin-react / React Testing Library / jsdom を追加していない(§1.2 外・N-00-3)。コンポーネントは `npm run dev` + スクショで代理検証し、純粋ロジック(mouse-gesture)のみ単体テスト。インタラクション系はユーザの手動確認。
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
- **判断/反映(要検討)**: 次のいずれか。(a) タイムアウトを ~2000ms へ引き上げる(総応答が NF-PERF-02 の 3–5s を超えうる)、(b) Router を memory 構築と並列実行してレイテンシ吸収、(c) 現状の best-effort(fallback)を許容し Router を補助的位置づけのままにする。MVP は (c) で動作。**MVP 完成後にブラッシュアップ**(ユーザ方針)。

### N-09-10 🟡 記憶抽出が毎メッセージ発火(短期20件超過後)→ コスト/レイテンシ増
- **該当**: 設計書 §3.3「短期記憶の保持と抽出トリガ」/ short-term.ts の overflow
- **内容**: 短期記憶が20件に達すると、以降は**メッセージごとに** overflow 抽出(`extractFromShortTerm('overflow')`)が走る。毎回 1 件だけを抽出するため、メッセージごとに抽出用の追加 Sonnet 呼び出しが発生し、コスト・レイテンシが増える。実機ログで毎メッセージ `memory extraction triggered: reason=overflow, entries=1` を確認。
- **動作上の問題**: なし(記憶は正しく抽出・記録される)。効率の問題のみ。
- **改善案(MVP後)**: (a) 未抽出が一定件数(例: 5–10)たまった時のみ抽出、(b) overflow 抽出をデバウンス/バッチ化、(c) 抽出をバックグラウンドキューに載せて会話レイテンシから切り離す。
- **判断**: MVP は現状で動作。**MVP 完成後にブラッシュアップ**(ユーザ方針)。

---

## task_10(起動シーケンス統合)

### N-10-1 🟡 `registerIpcHandlers` シグネチャは `(mainWindow, runtime)` を維持
- **該当**: task_10 §1(`registerIpcHandlers(mainWindow, charContext, apiKey)`)
- **内容**: 既存の `AppRuntime`(`{ charContext, apiKey, initialGreeting }`)パターンを維持し、`(mainWindow, runtime)` のままにした。APIキーダイアログ保存時に runtime.apiKey を更新でき、状態を1オブジェクトに集約できるため。
- **反映**: task_10 §1 のシグネチャを runtime ベースに統一。

### N-10-2 🟡 `extractFromShortTerm` は DI シグネチャ `(reason, makeLlmComplete(apiKey))`
- **該当**: task_10 §1/§6(`extractFromShortTerm("shutdown", charContext)`)
- **内容**: N-03-4 の DI 方針に従い、charContext ではなく LLM 呼び出し(`makeLlmComplete(apiKey)`)を注入する。Memory 層は Claude を直接知らない。
- **反映**: task_10 のコード例を DI 版へ。

### N-10-3 🟡 起動挨拶は pull 方式(`getInitialGreeting`)
- **該当**: task_10 §3/§4(push: `did-finish-load` → `send('ene:initial-greeting')`)
- **内容**: push は Renderer の useEffect 登録前に発火しうる競合がある。runtime.initialGreeting に挨拶を用意し、Renderer がマウント時に `getInitialGreeting()` で1回取得(取得後クリア)する pull 方式にした。実機で吹き出し「…おかえり。」表示を確認。
- **反映**: §8.7 の挨拶受け渡しを pull 方式に更新(または push なら描画後送信を明記)。

### N-10-4 ⚪ 誕生日「祝われた」記録を send-message に追加(§3.1 / §5.4)
- **該当**: task_10 §5 ステップ7
- **内容**: `birthdayHint === 'today'` かつユーザ入力に祝福語(おめでとう等)が含まれる場合、`recordBirthdayCelebrated(year)` を呼ぶ。
- **反映**: 設計書 §3.1 の誕生日フローどおりの実装。

### N-10-5 ⚪ 起動挨拶は 'forgotten' 誕生日にも対応
- **該当**: task_10 §3 / 設計書 §3.1
- **内容**: `birthdayHint === 'forgotten'` の場合、起動挨拶として forgotten 反応(fewshot)を返す。today の祝福は会話側の few-shot で扱う。
- **反映**: §8.7 の挨拶ロジックに forgotten ケースを明記。

### N-10-6 ⚪ before-quit で非同期終了処理(preventDefault + isQuitting ガード)
- **該当**: task_10 §6/§7 / 設計書 §7.2
- **内容**: `app.on('before-quit')` で preventDefault → runShutdownSequence(記憶抽出 + 短期記憶クリア)→ `app.quit()`。再入防止の isQuitting フラグ。runtime.apiKey がある時のみ実行。
- **検証メモ**: 起動シーケンス(書込検証・APIキー・キャラ・記憶ディレクトリ・誕生日・ウィンドウ・挨拶)は実機で app starting→active character→app ready とエラー無しを確認。**graceful 終了時の抽出・短期記憶削除、初回起動挨拶(active-character.json 削除時)、誕生日反応、クラウド警告**はユーザの手動確認に委ねる(実操作が必要)。

---

## task_11(ビルド・配布)

### N-00-4 🟢 解決: Electron を devDependencies へ移動(ユーザ承認済み)
- **該当**: CLAUDE §2.2 / 設計書 §1.2(Electron を「同梱=dependencies」に分類)
- **内容**: `npm run package:portable` で `⨯ Package "electron" is only allowed in "devDependencies"` でビルド拒否(electron-builder の要件)。
- **判断/反映**: ユーザ承認のうえ electron を devDependencies へ移動。CLAUDE §2.2 と設計書 §1.2 に「Electron は例外的に devDependencies、ただしランタイムは exe に同梱される」と注記済み。package-lock.json も更新。

### N-11-1 🟡 winCodeSign の展開がシンボリックリンク権限不足で失敗(回避策あり)
- **該当**: electron-builder のパッケージング(Windows・非管理者/開発者モード無効)
- **内容**: winCodeSign アーカイブ内の macOS 用シンボリックリンク(`darwin/.../libcrypto.dylib`, `libssl.dylib`)作成に Windows のシンボリックリンク権限が必要で失敗 → ビルド全体が失敗。
- **回避策(実施)**: winCodeSign の 7z を手動展開してキャッシュ `winCodeSign-2.6.0` に配置(darwin リンクの失敗は無視。Windows ツールは展開される)。
- **恒久対策(要検討)**: Windows 開発者モード有効化 or 管理者ビルド。メモリ [[electron-binary-manual-extract]] にも記録。

### N-11-2 🔴 **重要(不具合修正)**: portable exe のデータ保存先は `PORTABLE_EXECUTABLE_DIR`
- **該当**: 設計書 §3.6 `getPortableDataDir()`(`path.dirname(process.execPath)`)/ F-LIFE-07
- **症状**: portable exe 実行時、`data/` が exe の隣でなく %TEMP% の自己展開先に作られ終了時に消える(成功基準5を破る)。
- **原因**: portable ターゲットは自己展開型で %TEMP% から実行するため `process.execPath` が一時ディレクトリ。元 exe の場所は環境変数 `PORTABLE_EXECUTABLE_DIR` で渡される。
- **修正**: `getPortableDataDir()` で `process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath)`。実機で `dist\data\`(exe の隣)に config/memory 生成を確認。
- **反映(要)**: 設計書 §3.6 の実装方針を `PORTABLE_EXECUTABLE_DIR` 優先に更新。

### N-11-3 🟡 electron.vite.config は task_11 §1 の変更を採用せず(自己完結バンドル方式)
- **該当**: task_11 §1(`externalizeDepsPlugin()` + `@vitejs/plugin-react`)
- **内容**: §1 と §2 が矛盾(externalize すると node_modules が必要だが §2 は除外)。`@vitejs/plugin-react` も §1.2 外(N-00-3)。
- **判断**: main/preload を自己完結バンドルにし、electron-builder の `files` で node_modules を除外(`!node_modules/**/*`)。`resources/**`(トレイアイコン)を同梱(N-07-6 解決)。
- **結果**: `dist\ENE-Desktop-0.1.0.exe` = **60.9 MB**(NF-SIZE-01 の 100MB 以下を達成)。

### N-11-4 🟡 パッケージ時のログ保存先が data/logs ではなく %APPDATA%(ブラッシュアップ)
- **該当**: 設計書 §2 / F-LOG-06,07(ログは data/logs/)
- **内容**: パッケージ版で `main.log` が `dist\data\logs\` ではなく `%APPDATA%\ene-desktop\logs\` に出力(dev では data/logs)。記憶・設定の永続化は正常。
- **判断**: 動作に影響しないため MVP 後にブラッシュアップ。

## task_12(受入テスト・成功基準8 の手動判定)

### N-12-1 🟢 受入テストは「機構の自動検証」と「LLM応答の人間判定」に分離
- **該当**: task_12 §1(自動受入テスト)/ CLAUDE §9.3(人間判定の自動化禁止)
- **内容**: タスクの雛形は `simulateConversation`/`sendUserMessage` で実 Claude 応答(「太郎」「知らない」等)を assert する形だったが、これは実 API + 人間判定が本質で非決定的・自動化不可(成功基準4・8)。
- **判断**: 自動受入テスト(`tests/acceptance/automated/`)は**決定的な機構**のみを検証する方針に変更。
  - `memory-recall`: 長期記憶 保存→新セッション読込→統合プロンプトへ反映(paths をモックで一時ディレクトリへ隔離)。
  - `domain-recognition`: 実 `characters/ene` をロードし、人格プロンプトに none 領域(パチンコ)+「知らないと返す」指示+AI自称防止が含まれることを検証。
  - `os-command-execution`: `executeOsCommand` のホワイトリスト(notepad/http限定/パストラバーサル拒否)。シェルはモック。
  - `api-security`: safeStorage モックで「保存物に平文 sk-ant- が出ない」往復・保存先が data/ 外。
  - `performance`: `dist/*.exe` のサイズ <100MB(未ビルド環境は `it.skipIf` で skip)。
- **LLM応答の質・AIっぽさ(成功基準8)・UI体感**は `tests/acceptance/manual-check.md` の手動プロトコル(5質問×5項目=25)に分離。**自己合格させず、ユーザが実機判定**(メモリ [[manual-check-division]])。
- **反映(要検討)**: 設計書/タスクの受入テスト節に「人間判定項目は自動化しない」旨を明記。実 E2E(Playwright 等)は MVP スコープ外。

### N-12-3 🟡 代理起動した exe のディスク書き込みは Claude コンテナに仮想化される(受入手順に影響)
- **該当**: task_12 手動確認(基準6 の api-key.enc 位置・基準1 の位置復元・基準5 の data/ 永続化)
- **内容**: 開発支援ツール(PowerShell/Start-Process)が Claude のパッケージ化(MSIX 風)コンテナ内で動作し、`%APPDATA%` への書き込みが `…\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\…` に仮想化される。代理起動した ENE のデータもそこへ入り、ユーザの実 `%APPDATA%\ene-desktop` には現れない(実 Explorer で「場所が利用できません」)。
- **影響**: **会話品質(成功基準8)は代理起動インスタンスでも有効**(GUI 表示・Claude API は正常)。一方、**ディスク所在の手動確認(基準1/5/6 の保存先)はユーザ自身による exe ダブルクリック起動で行う必要がある**。
- **判断**: ENE 製品側の不具合ではなく、検証環境固有の制約。受入手順に「ディスク確認系はユーザ実機起動で実施」と明記する。api-key.enc の暗号化内容(平文 sk-ant- を含まない / v10 DPAPI マーカー)は代理でも機械確認済み=基準6 暗号化は合格。

### N-12-2 🟢 vitest は専用 config を持たずデフォルト include で acceptance も収集
- **該当**: task_12 受入条件「`npm run test` で受入テストが含まれて実行される」
- **内容**: 本プロジェクトは `vitest.config.*` を持たず(`electron.vite.config.ts` は vitest 非対象)、vitest デフォルト include(`**/*.test.ts` 再帰)で `tests/acceptance/automated/*.test.ts` も自動収集される。結果 175 tests(うち受入 13)が `npm run test` で実行・合格。
- **反映**: 追加設定不要。新しい受入テストは `tests/acceptance/automated/` に `*.test.ts` で置けば自動的に対象になる。

---

## task_13(アニメ基盤・MVP 0.2「存在感」)

> 状態機械(idle/thinking/talking＋emotion＋pose)でスプライト表示を駆動。配置済み2D全身立ち絵10枚で実装・
> 実機(dev＋スクショ)検証済み(2026-06-07)。新規 npm ライブラリ無し(React+canvas+Web Audio)。表示層限定(挙動不変)。

### N-13-1 🟢 スプライトは characters/{id}/ 直下のまま(sprites/ へ移設しない)
- **該当**: task_13 §3 / §2 ツリー(sprites/ 想定)
- **内容**: 立ち絵は `characters/ene/` 直下(portrait*.png 10枚)を `animation.json` の `frames` が実ファイル名で参照。loader は characterDir から解決。`portrait.png` がフォールバック兼 neutral-base のため移設すると二重管理 or 複製(~5MB)になる。
- **判断**: sprites/ サブdirは作らない(意図的逸脱)。§2 ツリーは characters/{id}/ 直下に立ち絵＋animation.json を記す。

### N-13-2 🟢 全身立ち絵に合わせ寸法を再設計(縦長窓・中央帯)
- **内容**: 全身比≈0.65。ウィンドウを 260×400→**260×520**。`.character` は `width:100%; height:calc(100% - 152px); top:100px; object-fit:contain; object-position:bottom center`。上100px=吹き出し、下52px=入力欄の余白を確保し本体に重ねない。
- **重要バグと修正**: img(置換要素)に width/height を与えず top/bottom/left/right だけで指定すると**実寸(832×1281)のままはみ出して見えなくなる**。明示寸法で解消(F-ANIM の前提)。動的リサイズはしない。

### N-13-3 🟢 emotion = 応答型 ChatResponse の任意フィールド(コード固定6ラベル)
- **内容**: `ConversationResponse(chat)` に `emotion?: EmotionLabel`。`EMOTION_LABELS=[neutral,joy,anger,sorrow,surprise,embarrassed]` はコード固定(層間の契約)。prompt-builder の出力形式(Tier0)に許可ラベルを追記、response-parser が許可外/欠落→ undefined(表示側 neutral)。4層防御は不変。
- **反映**: §3.4(emotion)。

### N-13-4 🟢 未制作フレームは neutral フォールバック＋「考える間」は「…」
- **内容**: `thinking`/`sofa`/`surprise` は素材未制作。`resolveFrame` が neutral へフォールバック(F-ANIM-06/11)。考える間(F-ANIM-04)は thinking 中に「…」吹き出しで演出(専用スプライト不要)。sofa は状態遷移のみ(視覚は neutral・後日素材追加で有効化)。

### N-13-5 🟢 口パクはメッセージ長に比例(永遠に動かさない)
- **内容**: talking 中のみ口開閉(`MOUTH_FLAP_MS=150` トグル・現フレーム base⇄baseOpen で**表情は保持**)。talking の継続は `clamp(len×MOUTH_FLAP_MS, 400, 6000)ms`(≈一文字1口パク)で、話し終えたら idle へ戻し口を閉じる(吹き出しは表示継続)。当初 talking が吹き出し表示(最大30s)の間続く不具合を修正。

### N-13-6 🟢 スプライトは base64 dataURL で IPC 配布・クリック音は Web Audio 合成
- **内容**: `getCharacterInfo` を拡張し `CharacterInfo.animation`(frames=dataURL群・~7MB一度きり)を返す(CSP/sandbox・N-08-1 同方針)。`isOpaqueAt` は現フレームの canvas alpha＋contain の letterbox 補正(F-ANIM-08)。クリック音は AudioContext 合成(外部音源なし・F-ANIM-10)。

### N-13-7 ⚪ ルート変更の含意(2D路線)
- 素材が VRoid でなく2D立ち絵のため、将来の本格モーションは three-vrm でなく **Live2D 路線**が自然(`research-image-pipeline` 結論)。philosophy 1.0(Live2D/VRM)の選択に反映を検討。

### N-13-8 🟡 未制作の追加素材(後日・コードでない)
- `thinking`/`sofa`/`surprise` の2D立ち絵を追加し `animation.json` の `map.thinking`/`map.sofa`/`frames` を足すだけで有効化(コード変更不要)。emotion few-shot(B-2)・JSON 精緻化(C)も随時。

---

## task_15(記憶想起エンジン・非破壊更新)

> MVP 0.3「記憶の会話活用強化」。Phase A(語彙＋entity)＋Phase B(ベクトルRRF)を実装・テスト・
> 実モデル/実API でエンドツーエンド検証済み(2026-06-07)。設計書 §1.2/§2/§3.3/§5.2/§5.5 へ反映済み。

### N-15-1 🟢 EpisodicMemory v2(全 optional・後方互換)
- **内容**: `schemaVersion?`/`entities?`/`supersededBy?`/`extra?` を追加、`tags?` を任意化。読取時 `migrateEpisodic` で欠落補完(ファイルは書き換えない)。
- **反映**: §3.3 型定義・§5.2 例を v2 へ更新。

### N-15-2 🟢 記憶ID = episodic ルートからの相対パス(設計書記述の訂正)
- **該当**: design-revision-memory-v2 §1.1「ファイル名(`{date}.json`)が一意IDを兼ねる」
- **内容**: ファイル名単独は year/category 跨ぎで衝突しうるため、ID は `"{year}/{category}/{file}.json"` の相対パスに**訂正**。`saveEpisodic` は ID を返し、`loadAllEpisodicFiles` は `EpisodicRecord[]`(ID付き)。`loadEpisodicById`/`updateEpisodicById` を追加。
- **反映**: §3.3 関数シグネチャ更新。

### N-15-3 🟢 想起を Router 非依存に(MemoryRetriever)
- **内容**: 会話時の想起を `matchedTopic` タグ検索から `buildMemoryContext({ text })`→`MemoryRetriever.retrieve` に切替。Router は知識ドメイン判定のみ。`searchEpisodic`(明示フィルタ)は存続。
- **反映**: §3.3・N-07-3 改訂。

### N-15-4 ⚪ Phase A 語彙層は形態素解析器を入れない
- **内容**: 日本語形態素解析器は新規依存になるため見送り。逆引きは entity/tag の部分一致(双方向 includes)で実装。意味の橋渡しは Phase B(ベクトル)が担当。

### N-15-5 🟢 非破壊更新(supersede/refine/reattribute)
- **内容**: `applyCorrections` で旧記録に `supersededBy` 付与(物理削除なし)/summary・entities の refine/その1件のみ reattribute。確信が低い更新は抽出器が出さない＋ライブ層で ENE が口頭確認(**保存される確認ステートを持たない**=§5.3)。
- **反映**: §3.3 に方針記載。

### N-15-6 🟢 抽出の2層フロー＋抽出器シグネチャ変更
- **内容**: (live)retriever が旧記憶をプロンプトに載せる/(persist)抽出時に retriever を1回回し `relevantMemories` を渡す→`corrections` を非破壊適用。`extractMemoryFromConversation(unextracted, relevantMemories, complete)` に変更し `corrections?` を出力。
- **反映**: §3.3 シグネチャ更新。

### N-15-7 🟢 派生キャッシュ＋ベクトル増分は retriever 経路に集約
- **内容**: `index/inverted.json`・`index/vectors.json` は真実の源でなく再生成可(削除で自己修復)。**埋め込みは retriever 経路でのみ実行**(抽出/更新フローはモデルに触れない=モデル未配置でも書き込みが動く)。新記録のベクトル化は次回想起時に `syncVectorIndex` で増分。
- **反映**: §2/§5.5 に index/・relationships/ 追記。

### N-15-8 🟢 Phase B 埋め込み = @huggingface/transformers + ruri int8(ローカル限定)
- **内容**: `@huggingface/transformers ^4.x`(onnxruntime-node 推移同梱)。モデルは `cl-nagoya/ruri-v3-310m` int8(別DL `data/models/`)。実行時の外部DL禁止(`env.allowRemoteModels=false`)。未配置時は `isEmbeddingModelAvailable()` で判定し**語彙のみフォールバック**。入力プレフィックス必須(`検索クエリ:`/`検索文書:`)。dtype `q8`→`model_quantized.onnx`。
- **検証**: 実モデルで読込664ms・768次元・「赤点」が study 0.85 > food/person 0.80(意味の橋渡し成立)。
- **反映**: §1.2 へ確定追記。

### N-15-9 🟢 配布は native・win-x64・CPU限定
- **内容**: `onnxruntime-node` は全OS native で 211MB のため、配布は win-x64 の CPU コア(`onnxruntime.dll`＋`*_binding.node` 約24MB)のみ同梱。GPU用 DirectML(約38MB)・他OS・`onnxruntime-web`(約130MB)は除外。`electron.vite.config.ts` で external 化、`electron-builder.yml` の files/asarUnpack を設定。コア exe は約100MB境界。
- **要フォロー**: 実機 `npm run package:portable` での起動確認(DirectML除外で binding がロードできるか)は未了。

### N-15-10 🟢 手動テスト資材と実機エンドツーエンド検証
- **内容**: `scripts/seed-recall-fixtures.mjs`(仮記憶)/`scripts/download-model.mjs`(モデル取得)/`tests/acceptance/memory-recall-manual.md`(S1〜S5)。
- **検証(実API/実モデル)**: S3 意味想起(赤点→勉強)、S4 supersede(鈴木・非破壊で旧に supersededBy)、S5 reattribute(田中→田中一郎で3件束ね)をエンドツーエンドで確認。単体テストは全パターン網羅(API/モデル不要・埋め込みはモック注入)。

### N-15-11 ⚪ 既知の軽微事項(対応不要)
- 抽出は1バッチ=1 episodic のため、1会話で複数話題が出ると1記録に統合されることがある(横断想起では問題になりにくい)。
- Router 毎ターン fallback は **N-09-9(既知のブラッシュアップ項目)**。想起は Router 非依存にしたため品質に影響しない。

---

## task_14(記憶リクエスト最適化・プロンプトキャッシュ)

> MVP 0.3「コスト＆軸の安定」。Phase 1+2+3 を実装・実機検証済み(2026-06-07)。
> 実測:1ターン目から `cache_read≈2457`(ウォーム由来)、毎ターン入力の約8割をキャッシュ読込に転換。挙動不変。

### N-14-1 🟢 BuiltPrompt.system を文字列→SystemBlock[] 化
- **内容**: `SystemBlock = { type:'text'; text; cacheable? }`。先頭=Tier0(不変・cacheable)、以降に準不変。`PromptMessage` に `cacheable?` を追加(履歴キャッシュ境界)。
- **波及**: prompt-builder / client(callModel 2経路)/ token-counter(ブロック合算)/ prompt-enhancer(SystemBlock[]→SystemBlock[]・強化文は非キャッシュ追加ブロック)。
- **反映**: §3.4・§3.3型(BuiltPrompt)。

### N-14-2 🟢 Tier 並べ替え(揮発を現ターンへ)
- **内容**: Tier0=人格+出力形式+自称制約(system先頭)。semantic=準不変(system 2番目)。**episodic/behavior/誕生日は現在の user ターン本文へ同梱**(system から除去)=安定プレフィックス化。
- **反映**: §3.4 の Tier 構造図。

### N-14-3 🟢 プロンプトキャッシュ(ベータ名前空間)
- **内容**: SDK 0.30.1 ではキャッシュは `client.beta.promptCaching.messages.create`。Tier0 ブロックと「現ターン直前メッセージ」に `cache_control:{type:'ephemeral'}` を付与(2境界)。`usage.cache_creation_input_tokens`/`cache_read_input_tokens` を **トークン数のみ**ログ(PII禁止)。SDK更新不要=§2.4 承認不要。
- **反映**: §3.4・§1.2 注記。

### N-14-4 🟢 few-shot を固定プレフィックス化(Phase 2 (A) を採用)
- **内容**: 全ドメインの few-shot(計13例)を毎回同一順で messages 先頭に。`fewshotKey` による動的選択は廃止。理由:例が少なく Router も実質フォールバック多発のため、声の安定＋履歴キャッシュ有効化の利得が上回る。
- **判断**: (A)固定 を採用((B)動的のまま は不採用)。Tier0 単体は1024トークン未満の可能性があるが、2つ目の境界(system+few-shot)が確実に1024超でキャッシュ有効。
- **反映**: §3.4。N-05-6(誕生日 few-shot)は、誕生日情報を現ターンの揮発コンテキストにテキストで同梱する方式へ変更。

### N-14-5 🟢 クリック起点ウォーム(Phase 3・レイテンシ施策)
- **内容**: 入力欄オープン時に IPC `ene:warm-cache` → `warmPromptCache` が**本会話と同一の buildPrompt** を `max_tokens:1` で送信し、安定プレフィックスを先に書き込む。揮発物はキャッシュ境界より後ろなのでダミーで可。
- **検証**: 実機で1ターン目 `write=0 read=2457`=ウォーム命中を確認。位置づけはレイテンシ施策(コスト微増・コスト削減策としては正当化しない)。
- **反映**: §3.4。preload/ipc/types/App に warmCache 配線。

### N-14-6 ⚪ スコープ外(本タスクで触らない)
- `temperature`(0.7)調整、抽出の Haiku 化(§3.3 が Sonnet 指定=要承認)、想起の中身(task_15)は対象外。本タスクは「送り方」のみ変更し会話内容・人格出力は不変。

---

## 方針転換(2026-06): 固定キャラ・人生記憶・心

> ユーザ承認済みの**方針転換**。原則は上位文書へ反映済み、設計詳細は
> `docs/archive/design-revision-character-heart.md`(マージ元)。
> **task_16 で実装完了(2026-06-07)**:N-16-1〜7 のデータ＋処理を実装し 03_design §2/§3.1/§3.3/§5 へ反映済み。
> 実装固有の追加判断は N-16-8〜11 を参照。実機検証:valence 抽出(負イベント→-2)・関係事実記録・心/canon/キャッシュ共存を確認。

### N-16-1 🟢 単一固定キャラ(魚川トリミ)へ。アーキテクチャの JSON 外出しは維持
- **該当**: vision §3柱2/§9、CLAUDE §5.1/§12、requirements F-CHAR-08/NF-EXT-03、philosophy §6/§7
- **内容**: 「キャラ入れ替え可能」を製品の売りにしない。一人の固定キャラに集中。旧 Phase5(多キャラPF)破棄。
- **判断**: 製品は固定。ただしコードは特定キャラ非依存・属性は JSON 外出しのまま(ハードコード禁止・賭けの可逆性)。
  ENE=コードネーム、魚川トリミ=キャラ名、`characterId` は当面 `"ene"`。
- **反映**: 上位文書反映済み。03_design §2/§3.1 のキャラ記述へ「単一固定」を注記(実装時)。
  キャラ資産の改名(identity name / fewshot 台詞の "ENE"→"魚川トリミ")は別の**創作タスク**。

### N-16-2 🟢 EpisodicMemory に provenance / valence を追加(人生記憶・心の素)
- **該当**: 03_design §3.3 / §5.2、design-revision-memory-v2(積み増し)
- **内容**: `provenance?: 'user'|'self'`(self=人生記憶 canon・読取専用・忘却外)、`valence?: number`
  (-2〜+2・中立観察・想起バイアス用)。全 optional・後方互換。
- **反映**: 03_design §3.3 の型へマージ。詳細は design-revision-character-heart §6(型定義)。

### N-16-3 🟢 人生記憶 canon は characters/{id}/life-memory.json(キャラ資産・配布物)
- **該当**: 03_design §2(characters/ ツリー)/ §5、別添A
- **内容**: キャラ自身の人生エピソードを canon として同梱。data/(ユーザ領域)へはコピーしない=不変・忘却外。
  想起時に user episodic と統合プールにマージ。
- **反映**: §2 の `characters/{id}/` ツリーに `life-memory.json` を追記。別添A にサンプル追加(執筆時)。

### N-16-4 🟢 心=記憶から導出(永続スカラー方式は不採用)
- **該当**: CLAUDE §5.3、philosophy §6、design-revision-character-heart §3、task_16
- **内容**: 「-100〜+100 を保存し日次±1/週次回帰」案は**不採用**。心情は直近 episodic の `valence` を
  recency 重み付き平均で**導出**(状態を貯めない)。減衰=直近重み。非対称(τ_neg<τ_pos)＋ `MOOD_FLOOR` で
  暗転ロック回避。想起バイアスは RRF に `λ·clampedMood·valence` 加算＋softmax。相手別は entity 限定の同式。
- **判断根拠**: §5.3 整合・部品最小(スカラー案より少ない)・脆弱ユーザへの加害回避(倫理の一線)。
- **反映**: 処理は task_16、データは design-revision-character-heart。03_design §3.3 へマージ。

### N-16-5 🟢 開示ゲーティング(関係に応じた記憶の開示)
- **該当**: CLAUDE §5.3、design-revision-character-heart §4、task_16(Phase 4)
- **内容**: 記憶に `disclosureLevel?`(1..5・欠落=1)を持たせ、`familiarityStage`(知り合ってからの日数・会話実日数・累計回数=**接触の事実**から導出・**単調非減少**)以下の記憶のみ想起候補にする。初対面で重い記憶(喪失・大恥・恋の核)を出さない。
- **判断根拠**: 「親しさ」を**好感度スカラーでなく時間の事実**で表せば §5.3 に抵触しない。開示=時間の事実／想起バイアス=心、と2軸分離。単調増加なのでドゥームループ無縁。
- **反映**: design-revision-character-heart §4。03_design §3.3/§5 へマージ。

### N-16-6 🟢 現在状態レイヤー(更新可能な"今")
- **該当**: CLAUDE §5.3/§6.1/§6.4、design-revision-character-heart §5、task_16(Phase 5)
- **内容**: 記憶を3層化。①固定canon(過去)=`life-memory.json`(不変) ②**現在の私(今)**=`current-state.json`(マイブーム/最近の家族の状況/追加趣味/現況・**事実のみ**) ③ユーザ episodic。趣味=核(固定)＋現在(可変)で「追加できる」を満たす。
- **判断根拠**: 「永遠だが今を生きる」を支える。MVP は**開発者更新でキャラ資産配布**(自律ドリフトなし)。自己更新は post-MVP・per-user で `data/`(所有権 §6.4)。
- **反映**: design-revision-character-heart §5。03_design §2(characters/ ツリー)/§5 へマージ。

### N-16-7 🟢 人生記憶 canon の内容確定とガードレール(A/B/C)
- **該当**: design-revision-character-heart §2.4、`docs/character-life-memory-canon-plan.md`、knowledge_domains.json
- **内容**: canon の**内容計画**(前提・カテゴリ別記憶リスト約41件・valence/importance/開示Lv)を計画書に確定。固定キャラ=人間の少女(IT は**完全独学**)、自己イメージは「ネットの住人」。**加齢しない日時**=絶対年でなく相対ライフステージ。
- **ガードレール**: A=ハッキングは才能(深い理解)のみ・実行は `refuse`・クーポンは過去の黒歴史。B=性的無知の失敗は**語ズラし**(非性的な大人語)へ・開示Lv5・性的会話に乗らない refuse 線。C=初恋は事実のみ認め**身体面は恒久はぐらかし**・深い開示は感情(ツン由来直結)。
- **判断根拠**: 未成年キャラ×性的/違法題材の製品リスク(審査・評判・脱獄)を、芯(電脳少女・無邪気な失敗・過去の恋)を残しつつ回避。
- **反映**: 個別記憶の執筆＋`characters/ene/life-memory.json` への JSON 変換・配置は**実装セッション**(計画書を入力)。
- **実装(task_16)**: draft の41記憶を `characters/ene/life-memory.json` に配置済み(全 provenance:self・valence 分布 ポジ23/中立7/ネガ11・開示Lv 1〜5)。ガードレール A/B/C は canon 文面に反映済み。実行系ハッキング refuse・性的会話 refuse 線は fewshot/knowledge_domains 側(将来の創作タスクで強化)。

### N-16-8 🟢 心情に中立プライアを追加(設計の正規化平均を補正)
- **内容**: 設計 §3.2 の `Σw·v/Σw`(正規化平均)は**古い負記憶だけが残ると 0 に戻らず暗転ロック**する。分母に `MOOD_PRIOR_WEIGHT=1` を足し `Σw·v/(Σw+prior)` とした。→ 沈黙(記憶が古い/少ない)で mood が 0 へ縮約・数件では微細、を実現(設計の「沈黙で0へ」§3.2 の意図を満たす)。
- **反映**: §3.3(mood.ts)。design-revision-character-heart §3.2 の式に prior を補う改訂。

### N-16-9 🟢 familiarityStage=接触の事実3要素・連言・Lv5≈1年
- **内容**: 経過日数 AND 会話実日数 AND ターン累計の**全部**が閾値を満たす最大段(`FAMILIARITY_THRESHOLDS`)。事実は `active-character.json` の `relationship`(firstMetAt/lastConversationDate/distinctConversationDays/totalTurns)に記録(誕生日履歴と同列の“事実”)。ユーザ決定:**Lv5≈1年**(365日/80会話日/800ターン)。`recordConversationTurn()` を user ターンで呼ぶ。
- **反映**: §3.1/§5.4(ActiveCharacter に relationship)。§3.3(familiarity.ts)。

### N-16-10 🟢 canon は recall-pool で統合(索引含む)・mood/安全網は user のみ
- **内容**: `loadRecallPool()` = user episodic ＋ canon(ID=`self/N`)。retriever・逆引き索引・ベクトル索引はこのプールを母集団に(canon も語彙/意味で引ける)。一方 **mood 導出と「直近×高importance」安全網は provenance:'user' のみ**(canon は直近の出来事ではない・想起を埋め尽くさない)。canon は supersede/保存/忘却の対象外。
- **反映**: §2/§3.3。

### N-16-11 🟢 心/開示は retriever の deps ゲートで後方互換
- **内容**: `RetrieverDeps={embedder?,mood?,familiarityStage?,rng?}`。未指定=mood0(バイアス無)・stage5(全開示)・argmax(決定論)=**task_15 の挙動と同一**。会話経路(`buildHeartDeps`)が now=`Date.now()` で mood/familiarity＋`Math.random` を注入。softmax サンプリング(`RECALL_SOFTMAX_TEMP`)で揺らぎ。λ/温度は調律可。
- **反映**: §3.3(retriever.ts)。既存 retriever テスト群は回帰なし(251緑)。

### N-17-1 🟡 音声方針の確定(2026-06-07 設計セッション・task_17)
- **内容**: 4決定 = ①ルート=ローカルファースト(脳=Claudeストリーミング・STT/VAD/Turnはローカル・§4.2維持) ②役割=双方向の音声会話 ③TTS=`TtsEngine`差し替え可能＋完全ローカル開始(§4.4) ④声=同梱・戦略A「寛容ライセンス声を採用＋味付け」(Kokoro/MeloTTS等をin-process・pitch/speedをJSON外出し)。旧「ユーザ各自VOICEVOXインストール」は任意オプションへ降格。
- **判断根拠**: ローカルファーストは**プライバシー(§4.2 外部送信はClaudeのみ)**が要請。クラウドS2Sに頼らずとも、ローカルのターンテイキング(Smart Turn v3.2)＋ストリーミングで実用レイテンシは達成できる。同梱要望に対し寛容ライセンス声で無料配布を両立。
- **⚠️ 2026-06 是正**: 当時の「速さは追わない/リアルタイム性は抑える対象」という根拠は**誤り**(哲学 §1.4 軸②で是正)。決定(双方向ローカル音声)は維持しつつ、**速さは常に最大化**する。
- **反映**: `tasks/task_17_voice.md`。memory `voice-plan-decisions-2026`。

### N-17-2 🟡 STT=VAD区切りWhisper(ストリーミングSTT不要)・SenseVoice回避
- **内容**: turn-based cascade(mic→Silero VAD→Smart Turn v3.2終話判定→**非ストリーミングWhisperで確定発話を書き起こし**→Claude→文単位TTS)。**ストリーミングSTTモデルは使わない**=調査で未確認だった日本語ストリーミングモデル実在リスクを回避。エンジン候補=`sherpa-onnx`(Apache・Node binding・プリビルド・STT+VAD一本化)だが自前onnxruntime重複が論点。モデル=Whisper(MIT)。**SenseVoiceは商用ライセンス懸念(規約4.2)で回避**。
- **反映**: task_17 アーキテクチャ/未決#1。

### N-17-3 🟡 最大の改修=C1ストリーミング再設計・C2文単位自称検知
- **内容**: C1=非ストリーミング`{type,message,emotion}`契約を「喋るプレーンテキストstream」と「os_command構造化出力」へ分離(キャッシュ安定プレフィックスは維持)。C2=4層防御を**文単位でTTS発話前にゲート**(喋り始めたら取り消せないため)。
- **反映**: task_17 最大の技術改修。

### N-17-4 🟢 N-15-9 解消(packaging検証)・音声の土台確認
- **内容**: `npm run package:portable` 成功(exit 0)。`dist/ENE-Desktop-0.1.0.exe`=**72MB**(<100MB)。`app.asar.unpacked/.../win32/x64/onnxruntime_binding.node`＋`onnxruntime.dll` 同梱確認・`DirectML.dll` 除外確認(CPU限定方針どおり)。**音声がonnx依存を増やす前の土台が健全**と確認。残り=実機での起動ランタイム1回(ベクトル想起発火でnative load成功確認)。
- **反映**: N-15-9 を packaging 面で解消。

### N-17-5 🟡 同梱ライセンスの鉄則(種は寛容側から)
- **内容**: 出力モデルの再配布可否=「エンジンlicense × 種(seed)license」両方。**採用可**=Kokoro/MeloTTS/Parler出力(Apache/MIT)・つくよみコーパス(商用/再配布OK)・JVNV(CC BY-SA)・Whisper(MIT)・sherpa-onnx(Apache)・Silero・Smart Turn(BSD)。**回避**=Fish-Speech(CC-BY-NC)・XTTS(CPML)・SenseVoice(懸念)・VOICEVOXキャラ声クローン・Style-Bert-VITS2直接同梱(AGPL→AivisSpeech経由でLGPL)。
- **反映**: task_17 ライセンス制約。

### N-17-6 🟢 §4.2例外を承認(AivisSpeechエンジン/モデルの初回DL)
- **内容**: ユーザ明示承認(2026-06-07)。音声機能で **AivisSpeech エンジン＋音声モデル(AIVM)を初回起動時にネット取得**することを許可。**§4.2/§7.1/§12「Claude以外への外部通信」への限定的例外**。届け方=管理サイドカー(手動インストール不要で"同梱体験"・コア<100MB維持)。
- **スコープ厳守**: 取得対象は**エンジン/モデル本体のみ**。**音声データ・会話・記憶・テレメトリは一切送信しない**。取得後は localhost:10101 サイドカーで完結。
- **声**: クリーンな女性ボイス(つくよみ→自作AIVM)。**Anneli は無断クローン問題で不可**(N-17-5/voice-plan)。
- **反映**: `docs/archive/design-revision-voice.md` §4.3/§8。承認後 03_design §4.2/§7.1 に「音声エンジン取得の例外」を明記してマージ。

### N-17-7 🟡 Phase A 着手: C1中核(文分割・ストリーミング応答パーサ)を実装
- **内容**: `src/conversation/sentence-splitter.ts`(日本語の文単位分割)＋ `src/conversation/stream-parser.ts`(`[[emotion:LABEL]]`＋本文＋任意 `[[os_command:{...}]]` のインクリメンタル解釈)を新規追加。純粋ロジック=単体テスト対象(既存フロー非影響)。sentinel 書式は**暫定**(実モデルでのスパイク後に確定)。
- **反映**: design-revision-voice §2(C1)。

### N-17-8 🟢 Phase B(STT・マイク入力)実装＋実機検証(2026-06-08)
- **構成判断(重要)**: STT は **main プロセス + onnxruntime-node + ローカル事前配置モデル**で実装。`src/memory/embedder.ts` と**完全同型**(`env.allowRemoteModels=false`／`env.localModelPath=getModelsDir()`／別DLスクリプトで `data/models/` へ配置)。当初検討した「renderer + transformers.js + WebGPU」は **renderer の CSP/WASM/onnxruntime-web 統合リスク**が大きく、§7.1 の「実行時に外部からモデルを取らない」確立パターンとも乖離するため**不採用**。renderer は **getUserMedia によるマイク取得のみ**(CSP 変更ゼロ)。
- **モデル**: `onnx-community/whisper-large-v3-turbo`(encoder=fp32／decoder=q8`_quantized`)。**精度最優先**の選択(ユーザ要求「とにかく正確に」)。turbo はデコーダ4層で large-v3 比 約8倍速。`scripts/download-stt-model.mjs`(`npm run download:stt-model`)が HF API でファイル一覧を引き、configs＋encoder＋decoder＋**external-data(`*.onnx_data`)** を取得。**落とし穴**: 大きい ONNX は重みを `encoder_model.onnx_data` に分離(ONNX external data 形式)。連れファイル未取得だとロード時に `*.onnx_data not found` で落ちる → スクリプトで `<onnx>_data` を必ず同伴取得。
- **実機検証(`npm run stt:smoke`)**: torimi 自身の TTS 音声(voice-smoke-out)を書き起こし。**ロード3.0s／~3s音声を~3sで認識(CPUで等倍)／日本語精度=非常に良好**(2文は完全一致、固有名詞「魚川トリミ」のみ音写)。**CPU で実用域=GPU は任意**を実証(main+CPU 判断が妥当)。WebGPU は将来の速度最適化レバーとして温存。
- **マイク権限**: `window.ts` で当該 session に `setPermissionRequestHandler`/`setPermissionCheckHandler` を設定し **`media` のみ許可**(他権限は拒否=最小権限)。録音音声は外部送信せずローカル STT にのみ使用(§4.2/§7.1)。
- **UX**: 入力欄に 🎤 **push-to-talk**(押下中だけ録音→離すと認識→既存 `sendMessage` へ流す=テキスト入力と同経路)。`src/renderer/mic-capture.ts` は `AudioContext({sampleRate:16000})` で 16kHz mono Float32 を直接取得(手動リサンプル不要)、gain=0 ノードでハウリング回避、ScriptProcessorNode 採用(AudioWorklet 用の別バンドルを避ける)。IPC `ene:transcribe-audio` は §6.2 厳守で**本文を出さず文字数のみログ**。
- **残(手動・人間判定)**: 実際にマイクへ発話しての end-to-end(getUserMedia→IPC→認識→送信→TTS往復)はハードウェア依存=ユーザ手動確認。固有名詞精度は Whisper 一般の限界(将来 initial_prompt/語彙バイアスで改善余地)。
- **反映**: design-revision-voice §3(STT)。

### N-17-9 🔴 落とし穴: Silero VAD v5 は onnxruntime-node で壊れる → **v4 を採用**(2026-06-08)
- **症状**: Silero VAD **v5/v5.1**(ONNX・入力 `input/state/sr`)を onnxruntime-node(1.24.3)で回すと、**実人間音声でも発話確率が ≈0**(aepyx 実音声 max 0.003、無音 0.001、TTS 0.2)。エラーは出ない(無言の誤計算)。
- **切り分け(実機スモークで全消し込み)**: 音声は正常(同じ PCM を Whisper が完璧に書き起こし)/ 窓512正しい(1024/1536はエラー)/ state 形状[2,1,128]正しい(再構築しても不変)/ sr dims [] [1] 不変 / グラフ最適化 disabled/basic 不変。→ **モデル側の `If`+combined-state+動的形状を onnxruntime-node が誤計算**(警告 `Expected shape {1,-1,128}` が兆候)。
- **解決**: **Silero VAD v4.0**(入力 `input/sr/h/c`=h/c 分離・[2,1,64]・出力 `output/hn/cn`)に変更 → onnxruntime-node で**正しく動作**(実音声 max **1.000**・発話76%、無音 max **0.043**、TTS max 0.999)。しきい値 **0.5** で speech/silence をクリーン分離。配布=`resources/silero_vad.onnx`(v4・1.8MB・MIT・同梱)。
- **副次の重要事実**: **TTS 音声も Silero で 0.999 と判定される** → barge-in で ENE 自身の声がマイクに回り込むと VAD が誤発火する。**echoCancellation 必須・ヘッドホンで確実回避**(N-17 設計の通り)。barge-in は実機で AEC 効果を要検証。
- **教訓**: ローカル ONNX は「ロードできる/エラーが出ない」≠「正しく計算される」。**実データのスモークで数値を必ず確認**(STT/VAD とも実音声で検証して初めて分かった)。
- **反映**: design-revision-voice §4(VAD)。`scripts/download-vad-model.mjs` は v4.0 を取得。

### N-17-10 🟢 マイクUI統合＋入力方式の設定化(2026-06-08・ユーザ要望)
- **統合**: 旧「入力欄内の🎤(PTT)＋右下🎧(ハンズフリー)」の2ボタンを廃止し、**入力欄の下・中央の単一マイクボタン(大きめ48px)** に統合。ON(リッスン中=ハンズフリー起動中 or PTT 押下中)で緑に点灯・OFF は白。**状態テキスト(聞いてるよ/考え中)は廃止**=ボタンの ON/OFF だけで「聞いている/いない」を示す。聞き取り中はキャラ neutral、考え中は従来どおり吹き出し「…」(transcribing 状態 ＋ respond の thinking で表示)。
- **設定**: 右クリックメニューに「マイク入力方式」サブメニュー(radio: Push-to-Talk / ハンズフリー)。`data/config/app-settings.json`(平文JSON・新規・§6.1)に永続化。main 起動時に読み込み runtime へ。変更は menu→main 保存＋`ene:voice-input-mode-changed` で renderer へ通知。IPC `ene:get-voice-input-mode`。
- **新規/変更**: `shared/types/settings.ts`(VoiceInputMode/AppSettings)・`storage/app-settings.ts`・`getAppSettingsPath`(paths)。`character-context-menu.ts` にサブメニュー。`InputArea` はテキストのみへ戻し、PTT 録音ロジックは `App` の統合ボタンへ集約(PTT=push-to-talk hold、ハンズフリー=click トグル)。方式切替時は旧方式を停止。
- **設計書差分**: `data/config/app-settings.json` は §2 ディレクトリ表に未記載の新規設定ファイル(config 配下・ユーザ設定の自然な追加)。→ **N-17-11 で §2 へ反映済み**。

### N-17-11 🟢 task_17 を正本へ反映(2026-06-08・ドキュメント整合)
- **内容**: Phase A〜C で確定した実装実態を SSOT へ反映。
  - `02_requirements.md`:**§2.14 音声入出力(F-VOICE-01〜11)** を新設。
  - `03_design.md`:**§1.2**(音声ライブラリ=新規npmなし・STT=transformers.js/whisper-large-v3-turbo・VAD=onnxruntime-node直/Silero v4同梱・TTS=AivisSpeechサイドカー・sherpa不採用)、**§2**(scripts/src 各層の音声ファイル・`resources/silero_vad.onnx`・`data/models/whisper-large-v3-turbo/`・`data/config/app-settings.json`・`characters/{id}/voice.json`・新規型)、**§3.4**(`reading?` 追加＋音声化フロー=非ストリーミング)、**§4.2**(音声IPC契約＋`warmCache`)、**§11.1**(実装済みマーク)。
- **反映上の重要判断(虚偽を書かない)**: **C1 ストリーミング再設計はライブ未配線**。`stream-parser.ts`/`sentence-splitter.ts`/`voice-chat.runVoiceChat` は純粋ロジック＋単体テストとして存在するが、実会話は従来どおり**完成JSONをパース → `speakText` で文単位合成**(非ストリーミング)。正本にはこの実態で記載し、ストリーミングは「将来レバー」と明記。
- **staging との乖離も明記**: `docs/archive/design-revision-voice.md` は Phase 0 案(sherpa-onnx・renderer VAD 等)を含むが、実装は onnxruntime-node 再利用・main VAD・Silero v4 に確定。正本は実装側を採用し、design-revision-voice は経緯ドキュメントとして残置。
- **未反映(意図的)**: F-ANIM-05 の「0.3 で音声振幅ドリブンに差し替える」は**未実施**(現状は時間ベース近似のまま)。§11.1 に残課題として記録。task_17 Phase D(声/レイテンシの人間判定)も未完。
- **反映**: 02_requirements §2.14 / 03_design §1.2・§2・§3.4・§4.2・§11.1。

### N-18-1 🟡 task_18 起こし＋相槌エンジン Phase A(純粋ロジック)実装(2026-06-08)
- **背景**: ユーザとの設計セッションで「能動的リスニング(相槌・思考フィラー)」を独立タスク task_18 として切り出し。**設計の憲法=三原則**(①性格を言い訳に遅さを正当化しない ②遅延の利用は速すぎる応答を一定の"間"まで遅らせるだけ ③相槌・フィラーは正当な機能でその時間は"棚からぼたもち")＋判別テスト「一瞬でも要るか?」を確定(`optimization-backlog.md` 冒頭・task_18)。
- **重要な開発制約**: 開発者は一人で**調教(学習データ作成・反復チューニング)ができない** → **Claude が本PC・本CPUで開発**。学習を要する設計を避け**ルールベース第一**、モデルを使うなら**Claude生成の合成データから本CPUで訓練**。ユーザ関与は**最終試聴判定のみ**(成功基準8=人間判定・§9.3)。
- **アーキ(二層)**: リアルタイム層=完全ローカル(脳/ネット非依存・既存VAD確率列に相乗り) / 内省層=Claudeが設計・合成データ生成・評価(本番に居ない)。相槌=聞くターン、思考フィラー「うーん」=答える入り(熟考時のみ・F-ANIM-04の音声ツイン・Phase C・判別は B-15 と共有)。
- **Phase A 実装(本CPUで完結検証)**: `backchannel-engine.ts`(`VadSegmenter` 同型の純粋状態機械=「持続発話→turn-end手前の短い言いよどみ」を検出・頻度ガバナ・1スロット1回)/ `backchannel-pool.ts`(`selectBackchannel`=型→語・反復回避・RNG注入)/ `shared/types/backchannel.ts` / `constants.ts`(`BACKCHANNEL_*`)/ `characters/ene/backchannels.json`(語彙外出し §4.5)。**typecheck/lint/全349テスト緑(新規17)。ハードウェア・調教不要。**
- **残(Phase B 以降・実機/人間判定)**: main 配線(`VadRuntime` 相乗り→`ene:backchannel` イベント)＋renderer 再生(事前合成WAV/即時合成)＋非言語アニメ(うなずき)＋韻律(RMS)による型選択 → Phase C 思考フィラー → Phase D 評価ループ＋ユーザ試聴。
- **レイテンシ施策**: 同セッションで `optimization-backlog.md` に三原則＋B-13(忘却=記憶容量ガバナ §11.6)・B-14(想起パスのローカル高速化)・B-15(ローカル判別器＋二段Claude)・B-16(ノブ)を追記、B-06(ストリーミング)を TTS辞書→`reading`廃止案で補強。
- **反映予定(task_18 完了時)**: 02_requirements F-LISTEN-xx / 03_design §2・§11。

### N-18-2 🟡 相槌エンジン Phase B 配線(continuer＋うなずき)実装(2026-06-09)
- **方針**: best-effort・gated。音声無効(エンジン未起動/voice.json/backchannels.json なし)なら相槌は出ず会話は成立。**ハンズフリー時のみ**(VAD フレーム供給がある経路)。
- **main**: `backchannel-controller.ts`=`BackchannelController`(`prepare`=hands-free 開始時に相槌語を一度ずつ**事前合成**してキャッシュ・非ブロッキング/`onFrame`=**ENE 非発話中のみ**`BackchannelEngine` に投入→判定したら合成済み WAV を送信/`reset`=ターン境界)。`character/backchannel-loader.ts`=`backchannels.json` 検証ロード(continuer 必須)。`vad-runtime.ts` のフレームループに相乗り(`!this.speaking` のときだけ `onFrame`・エコー自己発火回避)。`ipc.ts` で構築(**tts/voiceConfig は起動順=registerIpcHandlers が initVoice より前 のため遅延参照**)。
- **renderer**: `backchannel-player.ts`=単発再生(応答キュー `audio-player` とは別系統)。`App` の `onBackchannel`→即時再生＋`nodKey++`。`CharacterDisplay` に `nodKey`→CSS `ene-nod`(うなずき・スプライト不要・breathe より後勝ち)。
- **IPC/型**: `ene:backchannel`(WAV)・preload `onBackchannel`(単一リスナー)・`EneAPI.onBackchannel`・`paths.getBackchannelPoolPath`。
- **スコープ**: 型は **continuer 固定**(語の反復回避で変化はつく)。**韻律(RMS)による型選択(understanding/surprise)は次**。思考フィラー「うーん」は Phase C(B-15 の深い/浅い判別と連動)。
- **検証**: typecheck/lint/**全358テスト緑**(新規9=loader6/controller3。engine9・pool8 は Phase A)/build 緑。**ハードウェア・調教不要で静的検証完結**。
- **⚠️ 要実機検証(N-17-9 と同根)**: 相槌はユーザ発話中に鳴る→マイク回り込みで(a)録音(Whisper入力)汚染 (b)VAD 誤発火 のリスク。`echoCancellation` 前提。**問題が出たら nod-only(audio 無効)へ縮退可能**(タイミング/うなずきはそのまま)。
- **残(実機/人間判定=ユーザ)**: タイミングの自然さ・「聞いてもらえている」感・打ちすぎ/早すぎ・エコーの実害。次の実装=韻律型選択 → Phase C 思考フィラー → Phase D 評価ループ。

### N-17-12 🟢 音声エンジンのライフサイクル化(起動時 auto-spawn・終了時 kill)(2026-06-09・ユーザ要望)
- **背景(不具合)**: exe を起動しても AivisSpeech が立ち上がらず声が出ない。原因は**エンジンを起動するコードが存在しない**こと。`voice-runtime.ts` は `http://127.0.0.1:10101` へ**接続を試みるだけ**で、`voice-provisioner.ts` の `ProvisionEnv`(`startEngine`/`waitHealthy` を定義)を実装する**副作用アダプタが未実装・未配線**だった(メモリの積み残し「プロビジョナ副作用アダプタ」)。
- **配布方針(ユーザ合意)**: エンジンは 818MB(+BERT 623MB+声モデル 238MB ≒ 初回 1.7GB)で **100MB上限(§4.3)に同梱不可**。過去の承認 N-17-6 どおり **方針A=初回サイレント自動DL**(exe<100MB維持・「DLしますか?」と聞かない)を採用。**BERT と既定モデルはエンジン自身が初回起動時に HF から自動取得**するため、アプリは「起動して待つ」だけでよい(取得を肩代わりしない)。エンジン配置先=**`data/voice/engine/`**(ポータブル)。
- **サイズ実態の調査**: 818MB の大半は日本語読み辞書(sudachi 208MB+追加辞書 196MB+openjtalk 99MB≒500MB=誤読対策の本体)。**安全に削れるのは GPU 用 `DirectML.dll`(18MB)のみ**(CPU限定方針 N-17-4)。BERT は既に fp16、torimi.aivmx は単一 neutral=いずれも最小構成。"lite" エンジンは存在しない。
- **Phase 1 実装(本変更・この PC で実機検証可)**: `src/main/voice-engine.ts`(= 欠けていた副作用アダプタ)。**純粋ロジックと副作用を分離**(既存 DI 流儀): `decideEngineAction(reachable,present)`=skip/spawn/absent、`waitHealthy(probe,opts)`=probe 注入のポーリング(単体テスト対象)。`ensureVoiceEngine()`=`/version` 到達なら再利用(spawn しない=ポート衝突回避・**外部起動を kill しない** `ownsEngine` フラグ)/未配置なら `absent`(テキストのみ続行)/未到達&有りなら `spawn(run.exe, ['--host','127.0.0.1','--port','10101'], {cwd:engineDir, shell:false, windowsHide:true, stdio:'ignore'})`→`waitHealthy`。`stopVoiceEngine()`=`child.kill()`→猶予後 `taskkill /PID /T /F`(ツリー停止・冪等)。
- **配線**: `lifecycle.ts` で **Step 4.5 に `void ensureVoiceEngine()`(背景起動・await しない)**。ヘルス到達に実測 ~8s かかるため await するとウィンドウ表示後の `initialGreeting` 設定が遅れ、renderer の一度きり pull(`getInitialGreeting`)が null を掴んで**挨拶が消える**。背景起動なら挨拶も即・エンジンは初回メッセージまでに温まる。`initVoice` は従来どおり(未到達なら bundled voice.json で有効化。**bundled styleId 1736267264 は実エンジン値と一致**するため reconcile を待つ必要なし)。終了は `shutdown.ts` 冒頭で `stopVoiceEngine()`、保険で `index.ts` の `app.on('will-quit')` でも呼ぶ(apiKey 未設定で before-quit 非同期分岐に入らない経路の孤児防止)。
- **検証(実機)**: 同一引数/cwd で spawn→`/version` が **7.9s で 200(`1.3.0-dev`)**、`/speakers` に **魚川トリミ/ノーマル styleId=1736267264**(=bundled 一致)、`taskkill /T /F` 後 `/version` 不達(クリーン停止)。typecheck/lint/**全364テスト緑**(新規 voice-engine 6)。`setup:voice-engine` で `data/voice/engine/`(801MB・DirectML.dll 除外・git-ignored)配置。
- **新規 npm 無し**。spawn は固定パス+引数配列+shell:false(§7.2 準拠・N-17-6 承認例外)。`scripts/setup-voice-engine.mjs`(`npm run setup:voice-engine`)=scratch→`data/voice/engine/` コピー(DirectML.dll 除外・冪等)。**開発/ローカル配置ツール**で配布物に含めない。
- **残(Phase 2・配布用・別途)**: 初回サイレント自動DL を `ensureVoiceEngine` の `absent` 分岐で `provisionVoice(env)` 実装。`downloadEngine`=自前ホストの **engine.zip → Windows 標準 `Expand-Archive`/`tar.exe` で展開**(公式は分割 .7z で Node 展開不可のため zip 再ホスト前提)、`downloadModel`=torimi.aivmx を `%APPDATA%\AivisSpeech-Engine\Models\` へ、初回 UI=トリミ口調の進捗(許可プロンプトなし)。**未確定=① engine.zip / torimi.aivmx のホスティング先 URL ② zip 展開を OS 標準ツールで行う最終確認**。
- **反映**: 03_design §2(`data/voice/engine/` 追記)・§7.2(音声 spawn の承認済み例外を明記)。02_requirements は F-VOICE で TTS 差し替え可と既述のため変更なし。

---

## レイテンシー最適化 Tier 0(optimization-backlog B-01/B-02/B-14a/B-03b・2026-06-09)

> ユーザ承認のうえ着手(推奨順 Tier 0)。設計の憲法(レイテンシと"間"の三原則・原則1「計算は常に最小化」)に沿う**純粋な無駄取り**。品質劣化ゼロ・閉じた記憶層/オーケストレーション変更。typecheck/lint/**全385テスト緑**(新規 extraction-scheduler 4・short-term 刷新)。

### N-LAT-1 🟡 記憶抽出を応答クリティカルパスから外す(B-01/B-02・N-09-10 解消)
- **該当**: `short-term.ts` / `extraction-trigger.ts` / 新規 `extraction-scheduler.ts` / `ipc.ts` / `shutdown.ts` / 設計書 §3.3「短期記憶の保持と抽出トリガ」
- **変更**:
  - `appendShortTerm(entry, onOverflow?)` → `appendShortTerm(entry)`。`ShortTermOverflowHandler` 型を廃止し、overflow 時の**同期抽出をやめた**。
  - トリム方針を「古い順に**抽出済み(extracted=true)のみ**落とす」へ(`trimExtractedOverflow`)。**未抽出は絶対に捨てない**ので、抽出を背景化してもバッファが一時的に20件を超えるだけで記憶を失わない(抽出が追いつけば自己修復)。
  - 新規 `src/memory/extraction-scheduler.ts`:`requestExtraction(complete)`(fire-and-forget・直列化ロック `inFlight`・走行中要求は1回だけ coalesce・**未抽出が `EXTRACTION_BATCH_THRESHOLD`(=8)以上で**発火)/ `flushExtraction(complete)`(走行中を待ってから閾値無視で残り全部抽出=終了/孤児回収用)。
  - `ipc.ts handleSendMessage`:append から onOverflow を除去。assistant append 後に `requestExtraction(makeLlmComplete(apiKey))` を**await せず**発火。
  - `shutdown.ts`:`extractFromShortTerm('shutdown')` → `flushExtraction(...)`(in-flight を待ってから clearShortTerm)。`lifecycle.ts` の起動時孤児回収は変更不要(起動時に背景抽出は走らない)。
- **効果**: 満杯後に応答前段で直列していた抽出 Sonnet 呼び出し(user/assistant 両 append で最大2回/ターン・実測 +約9秒〜)を**応答経路から完全除去**。さらに毎メッセージ発火→8件バッチで Claude 抽出呼び出し回数を ~1/8 に削減(B-02)。
- **副次**: 8件まとめて抽出するため1件ずつより**まとまった文脈で episodic 化**しやすい(B-04 の「中期記憶が残りにくい」体感の改善方向・要実機確認)。1抽出=最大1 episodic の制約は不変。
- **クラッシュ耐性**: 背景抽出中にクラッシュしても未抽出は `short-term.json` に残り、次回起動の孤児回収か次の flush で抽出される(データ喪失なし・extracted フラグで二重抽出も防止)。
- **🟡 要反映(設計書 §3.3)**: ①L795/797 の `ShortTermOverflowHandler`・`appendShortTerm(entry, onOverflow?)` を現行シグネチャへ。②「抽出トリガ」節(L900-905)トリガ1を「20件超過時の同期抽出」→「未抽出が閾値(8)以上で**背景**バッチ抽出(直列化ロック)・トリムは抽出済みのみ」へ。③N-09-10 注記(L928-930)を**解消済み**へ。④`extraction-scheduler.ts` を主要関数/ディレクトリ図(L262 付近)に追記。

### N-LAT-2 🟡 episodic 二重ロード解消＋Router/想起の並列化(B-14a/B-14d/B-03b 部分)
- **該当**: `context-builder.ts` / `retriever.ts` / `ipc.ts`
- **変更**:
  - `RetrieverDeps` に `recallPool?: EpisodicRecord[]` を追加。`retrieveRecords` は `deps.recallPool ?? await loadRecallPool()`(未指定なら従来どおり=後方互換)。
  - 新 `buildConversationMemory(query)`:`loadAllEpisodicFiles()`(user)・`loadLifeMemory()`(canon)・`loadOrCreateActiveCharacter()` を**1回だけ並列ロード**し、mood/familiarity 導出と recallPool で**使い回す**。従来 `buildHeartDeps` ＋ `retrieve(loadRecallPool)` で**2回**走っていた `loadAllEpisodicFiles` が1回に。
  - `buildHeartDeps` 廃止(buildConversationMemory に内包)。`buildMemoryContext(query, deps)` は下位ビルダとして存続。
  - `ipc.ts` step2/3:独立な `classifyTopic`(Router)と `buildConversationMemory` を `Promise.all` で並列化(B-03b)。Router 往復(~800ms タイムアウト)を記憶構築に重ねて隠す。
- **注意**: Router タイムアウトが実 Haiku 往復を下回り fallback=medium になる **B-03 本体(few-shot 不発)は未解決**(並列化で critical path から隠れただけ)。B-03 は backlog 残置。
- **🟡 要反映(設計書 §3.3 L811-814)**: `RetrieverDeps` に `recallPool?` を追記。会話経路の記憶構築を `buildConversationMemory`(episodic 1回ロード)として記述。

> **残(Tier 0 続き・実機計測後に着手)**: B-14b(想起/埋め込みのワーカースレッド化)・B-14c(埋め込み起動時ウォーム＋クエリ埋め込みキャッシュ)。本3点(B-01/B-02/B-14a/B-03b)の実機レイテンシ計測を挟んでから判断する。

---

## 🔧 最適化・ブラッシュアップ項目 → `docs/optimization-backlog.md` へ移動

MVP 完成後に改善する項目(Router タイムアウト・記憶抽出のレイテンシ/頻度・
ログ保存先・未制作スプライト・キャラ改名 等)は、独立した
**`docs/optimization-backlog.md`** に集約した(2026-06 ドキュメント整理)。
本ファイルは実装過程の判断ログ(N-xx)に専念する。

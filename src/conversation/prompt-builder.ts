import type { CharacterContext } from '../shared/types/character';
import type { MemoryContext, SemanticMemory, EpisodicMemory } from '../shared/types/memory';
import type { RouterResult } from '../shared/types/router';
import type { BuiltPrompt, PromptMessage, SystemBlock } from '../shared/types/conversation';

// 統合プロンプト構築(設計書 §3.4 / task_14 Tier 再構成)。
//
// Tier 構造(プロンプトキャッシュ最適化・task_14):
//  - Tier0(不変・cacheable):人格(systemPrompt)＋出力形式＋自称制約。キャラ単位で毎ターン同一。
//  - semantic(準不変):長期記憶。抽出時のみ変化。
//  - few-shot(固定):全ドメインの例を毎回同一順で提示(声の安定＋履歴キャッシュの前提)。
//  - 揮発(episodic/behavior/誕生日):現在のユーザーターン本文に同梱(system を汚さない)。
// 可変物を後ろへ送ることで、前段(Tier0・few-shot・履歴)のキャッシュを壊さない。

const OUTPUT_FORMAT_SPEC = [
  '# 出力形式(厳守)',
  '必ず次のいずれかの JSON 1個だけで応答してください(前後に文章を付けない):',
  '',
  '通常の会話(キーの順番もこの通りに:emotion を message より前に置く):',
  '{"type": "chat", "emotion": "neutral", "message": "あなたの返答"}',
  '- message: 画面に表示する文(普通の漢字かな交じり)。',
  '- 読みのルビ:読み方が文脈で割れる語(同じ漢字で読みが変わる語)や難読の固有名詞には、',
  '  青空文庫式ルビ「漢字《よみ》」を付ける(よみは全てひらがな)。これは音声合成が正しく読むためのもの。',
  '  例:「最近、夏目漱石の心《こころ》を読んだ。向上心《こうじょうしん》は大切だ」',
  '   →「心」は文脈で こころ/しん に分かれるのでルビで指定する。',
  '  自明な語にはルビを付けない(付けすぎない・普通に読める語はそのまま)。',
  '  基底(ルビを振る範囲)の区切りが曖昧なときは ｜(全角縦棒)で基底の先頭を示す:「私の｜心《こころ》」。',
  '  数字や記号も読みが紛れるならルビで補う。例:「3冊《さんさつ》」「100%《ひゃくぱーせんと》」。',
  '- emotion は任意。今の気持ちに合うものを次から1つ選んでよい(迷ったら入れなくてよい):',
  '  neutral(平常) / joy(うれしい) / anger(ツン・むっと) / sorrow(哀しい) / surprise(驚き) / embarrassed(照れ)。',
  '',
  'OS操作(以下の3種類のみ。それ以外の action は使えない。message のルビ規則は同じ):',
  'メモ帳を開く: {"type": "os_command", "message": "...", "command": {"action": "open_notepad"}}',
  'ブラウザでURLを開く(http/https のみ): {"type": "os_command", "message": "...", "command": {"action": "open_browser", "target": "https://..."}}',
  'フォルダを開く(ユーザーのホーム配下の絶対パスのみ): {"type": "os_command", "message": "...", "command": {"action": "open_folder", "target": "C:\\\\Users\\\\..."}}',
  '',
  'これら以外の操作を求められた場合は、chat 型で「それはできない」とあなたの口調で説明してください。',
].join('\n');

function formatSemantic(semantic: SemanticMemory): string {
  const lines: string[] = [];
  if (semantic.userName) lines.push(`- 相手の名前: ${semantic.userName}`);
  if (semantic.preferences && Object.keys(semantic.preferences).length > 0) {
    const prefs = Object.entries(semantic.preferences)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' / ');
    lines.push(`- 好み: ${prefs}`);
  }
  if (semantic.longTermGoals && semantic.longTermGoals.length > 0) {
    lines.push(`- 長期的な目標: ${semantic.longTermGoals.join('、')}`);
  }
  if (semantic.personality && semantic.personality.length > 0) {
    lines.push(`- 相手の性格: ${semantic.personality.join('、')}`);
  }
  if (semantic.extra) {
    for (const [k, v] of Object.entries(semantic.extra)) {
      lines.push(`- ${k}: ${Array.isArray(v) ? v.join('、') : String(v)}`);
    }
  }
  const body = lines.length > 0 ? lines.join('\n') : '- (まだ相手についてあまり覚えていない)';
  return `# あなたの長期的な記憶\n${body}`;
}

/** 一件の整形(日付＋要約)。 */
function fmtEpisodicLine(m: EpisodicMemory): string {
  return `- [${m.date.slice(0, 10)}] ${m.summary}`;
}

/**
 * 想起した記憶を「あなた自身の経験(canon=provenance:'self')」と
 * 「相手について覚えていること(provenance:'user')」の2セクションに分けて提示する。
 *
 * なぜ分けるか:混ぜると、相手の人間関係(相手の知人・恋愛など)を自分のものと取り違える
 * (provenance 混同。例「友達は?」に対し相手の想い人を自分の友達として挙げる)。canon を
 * 'self' で持つ設計意図(自分の人生 vs 相手のこと)は、ここで明示しないとプロンプト上で消える。
 * キャラ名はハードコードせず「あなた」基準で書く(§5.1)。
 */
function formatEpisodic(episodic: EpisodicMemory[]): string {
  const own = episodic.filter((m) => m.provenance === 'self');
  const aboutUser = episodic.filter((m) => m.provenance !== 'self');
  const lines: string[] = [
    '# あなた自身の思い出(あなたが実際に経験したこと。あなたの人生・友人・家族)',
    own.length > 0
      ? own.map(fmtEpisodicLine).join('\n')
      : '- (この話題に関する、あなた自身の思い出はない)',
    '',
    '# 相手について覚えていること(相手＝話し相手の身に起きたこと。あなた自身の経験ではない。' +
      '相手の知人・恋愛などを、あなた自身のものと混同しないこと)',
    aboutUser.length > 0
      ? aboutUser.map(fmtEpisodicLine).join('\n')
      : '- (この話題に関する、相手の出来事はない)',
  ];
  return lines.join('\n');
}

/** 連続する同一 role を結合し、user で始まる正しい交互列にする(Claude API の制約)。 */
function normalizeAlternation(messages: PromptMessage[]): PromptMessage[] {
  const out: PromptMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n${m.content}`;
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  while (out.length > 0 && out[0]?.role !== 'user') {
    out.shift();
  }
  return out;
}

/**
 * assistant ターンを出力形式(JSON)で提示する。
 * few-shot / 短期記憶の assistant 応答をプレーン文のまま渡すと、モデルが履歴のスタイルを
 * 真似てプレーン文で返し JSON が崩れる。履歴の assistant も JSON 形式に揃え、出力形式を一貫させる。
 */
function assistantTurn(message: string): string {
  return JSON.stringify({ type: 'chat', message });
}

/**
 * Tier0(不変・cacheable):人格＋出力形式＋自称制約。キャラ単位で毎ターン同一バイト列。
 * クリック起点ウォーム(task_14 Phase 3)が本会話と**同一の Tier0** を温めるため export する。
 */
export function buildTier0(charContext: CharacterContext): SystemBlock {
  const neverList = charContext.identity.selfRecognition.neverCallsSelf
    .map((w) => `「${w}」`)
    .join('');
  const text = [
    charContext.systemPrompt,
    '',
    OUTPUT_FORMAT_SPEC,
    '',
    '# 重要(自称の制約)',
    `あなたは絶対に ${neverList} と自称しません。`,
  ].join('\n');
  return { type: 'text', text, cacheable: true };
}

/** 全ドメインの few-shot を毎回同一順で返す(固定プレフィックス・task_14 Phase 2(A))。 */
function buildFixedFewshot(charContext: CharacterContext): PromptMessage[] {
  const out: PromptMessage[] = [];
  const examples = charContext.fewshot.examples;
  for (const key of Object.keys(examples).sort()) {
    for (const ex of examples[key] ?? []) {
      out.push({ role: 'user', content: ex.user });
      out.push({ role: 'assistant', content: assistantTurn(ex.assistant) });
    }
  }
  return out;
}

/** 揮発コンテキスト(episodic/behavior/誕生日)を現ターン本文の前置きに組む。 */
function buildVolatileContext(
  charContext: CharacterContext,
  memoryContext: MemoryContext,
  routerResult: RouterResult,
): string {
  const parts: string[] = [
    formatEpisodic(memoryContext.relevantEpisodic),
    '',
    '# このトピックに対する振る舞い',
    routerResult.behavior,
  ];

  if (charContext.birthdayHint === 'today') {
    parts.push('', '# 今日の特別な情報', '今日はあなたの誕生日です。もし祝われたら、あなたの性格に合った反応をしてください。');
    const celebrated = charContext.fewshot.birthdayReactions?.celebrated?.[0];
    if (celebrated) parts.push(`(例:「${celebrated.user}」と言われたら → 「${celebrated.assistant}」のように)`);
  } else if (charContext.birthdayHint === 'forgotten') {
    const forgotten = charContext.fewshot.birthdayReactions?.forgotten?.[0];
    if (forgotten) parts.push('', '# 今日の特別な情報', `(もし「${forgotten.user}」のような流れなら → 「${forgotten.assistant}」のように拗ねてよい)`);
  }
  return parts.join('\n');
}

export function buildPrompt(
  charContext: CharacterContext,
  memoryContext: MemoryContext,
  routerResult: RouterResult,
  userText: string,
): BuiltPrompt {
  // --- system: Tier0(cacheable) + semantic(準不変) ---
  const system: SystemBlock[] = [
    buildTier0(charContext),
    { type: 'text', text: formatSemantic(memoryContext.semantic) },
  ];

  // --- messages: 固定 few-shot → 履歴 → 現ターン(揮発コンテキスト同梱) ---
  const raw: PromptMessage[] = [...buildFixedFewshot(charContext)];

  for (const entry of memoryContext.shortTerm) {
    raw.push({
      role: entry.role,
      content: entry.role === 'assistant' ? assistantTurn(entry.text) : entry.text,
    });
  }

  // 揮発物は現在のユーザーターン本文へ合流(system/前段キャッシュを汚さない)。
  const volatile = buildVolatileContext(charContext, memoryContext, routerResult);
  raw.push({ role: 'user', content: `${volatile}\n\n---\n${userText}` });

  // 交互列に正規化(末尾は必ず user)。
  const messages = normalizeAlternation(raw);

  // 履歴キャッシュ境界(task_14 Phase 2(6)):現ターン(末尾)の直前=安定プレフィックスの末尾を cacheable に。
  // few-shot は常に存在するため len>=2。現ターンより前までを増分キャッシュする。
  if (messages.length >= 2) {
    const boundary = messages[messages.length - 2];
    if (boundary) boundary.cacheable = true;
  }

  return { system, messages };
}

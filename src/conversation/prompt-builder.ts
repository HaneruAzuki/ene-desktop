import type { CharacterContext } from '../shared/types/character';
import type { MemoryContext, SemanticMemory, EpisodicMemory } from '../shared/types/memory';
import type { RouterResult } from '../shared/types/router';
import type { BuiltPrompt, PromptMessage } from '../shared/types/conversation';

// 統合プロンプト構築(設計書 §3.4)。
// charContext.systemPrompt(キャラ人格・AI自称防止)に、記憶・振る舞い・出力形式を足す。

const FEWSHOT_MAX = 3; // 該当ドメインから最大3例(増やしすぎない・設計書 §3.4)

const OUTPUT_FORMAT_SPEC = [
  '# 出力形式(厳守)',
  '必ず次のいずれかの JSON 1個だけで応答してください(前後に文章を付けない):',
  '',
  '通常の会話:',
  '{"type": "chat", "message": "あなたの返答"}',
  '',
  'OS操作(以下の3種類のみ。それ以外の action は使えない):',
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
  return lines.length > 0 ? lines.join('\n') : '- (まだ相手についてあまり覚えていない)';
}

function formatEpisodic(episodic: EpisodicMemory[]): string {
  if (episodic.length === 0) return '- (関連する過去の出来事はない)';
  return episodic.map((m) => `- [${m.date.slice(0, 10)}] ${m.summary}`).join('\n');
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

export function buildPrompt(
  charContext: CharacterContext,
  memoryContext: MemoryContext,
  routerResult: RouterResult,
  userText: string,
): BuiltPrompt {
  const neverList = charContext.identity.selfRecognition.neverCallsSelf
    .map((w) => `「${w}」`)
    .join('');

  const systemParts: string[] = [
    charContext.systemPrompt,
    '',
    '# あなたの長期的な記憶',
    formatSemantic(memoryContext.semantic),
    '',
    '# 関連する過去の出来事',
    formatEpisodic(memoryContext.relevantEpisodic),
  ];

  if (charContext.birthdayHint === 'today') {
    systemParts.push('', '# 今日の特別な情報', '今日はあなたの誕生日です。もし祝われたら、あなたの性格に合った反応をしてください。');
  }

  systemParts.push('', '# このトピックに対する振る舞い', routerResult.behavior);
  systemParts.push('', OUTPUT_FORMAT_SPEC);
  systemParts.push('', '# 重要(自称の制約)', `あなたは絶対に ${neverList} と自称しません。`);

  const system = systemParts.join('\n');

  // --- messages ---
  const raw: PromptMessage[] = [];

  // Few-shot(該当ドメインから最大3例)
  const examples = charContext.fewshot.examples[routerResult.fewshotKey] ?? [];
  for (const ex of examples.slice(0, FEWSHOT_MAX)) {
    raw.push({ role: 'user', content: ex.user });
    raw.push({ role: 'assistant', content: ex.assistant });
  }

  // 誕生日の特別反応 few-shot
  const reactions = charContext.fewshot.birthdayReactions;
  if (charContext.birthdayHint === 'today' && reactions?.celebrated?.[0]) {
    raw.push({ role: 'user', content: reactions.celebrated[0].user });
    raw.push({ role: 'assistant', content: reactions.celebrated[0].assistant });
  } else if (charContext.birthdayHint === 'forgotten' && reactions?.forgotten?.[0]) {
    raw.push({ role: 'user', content: reactions.forgotten[0].user });
    raw.push({ role: 'assistant', content: reactions.forgotten[0].assistant });
  }

  // 直近の短期記憶(実際の会話履歴)
  for (const entry of memoryContext.shortTerm) {
    raw.push({ role: entry.role, content: entry.text });
  }

  // 現在の入力
  raw.push({ role: 'user', content: userText });

  // 交互列に正規化する。末尾は必ず user メッセージ。
  // (Prefill = 末尾 assistant "{" は現行モデルが非対応のため使わない。N-09-7 参照)
  const messages = normalizeAlternation(raw);

  return { system, messages };
}

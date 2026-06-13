import type {
  CharacterIdentity,
  CharacterBackground,
  CharacterKnowledgeDomains,
  CurrentState,
} from '../shared/types/character';

// キャラクター人格のシステムプロンプト構築(設計書 §3.1 / §3.4)。
//
// ここで作るのは「キャラクターとしての人格・背景・知識の境界・AI自称防止」まで。
// JSON 応答形式(chat / os_command)の指示は会話プロトコルの関心事のため、
// Conversation Layer の prompt-builder(task_05)が付与する(疎結合・設計書 §3.4)。
//
// 📌 AI自称防止は neverCallsSelf を identity.json から読んで明示する。
//    コードに NG ワードをハードコードしない(CLAUDE §5.4 / task_02 禁止事項)。

/** 現在状態(task_16・決定5)を「# 今のあなた」節に整形する。不在なら空文字。 */
function formatCurrentState(currentState: CurrentState | null | undefined): string {
  if (!currentState) return '';
  const lines: string[] = [];
  if (currentState.currentHobbies && currentState.currentHobbies.length > 0) {
    lines.push(`- 最近ハマっていること: ${currentState.currentHobbies.join('、')}`);
  }
  if (currentState.familySituation) lines.push(`- 最近の家族のこと: ${currentState.familySituation}`);
  if (currentState.currentStatus) lines.push(`- 近況: ${currentState.currentStatus}`);
  if (lines.length === 0) return '';
  return ['', '# 今のあなた(最近の状況・自然に会話に滲ませてよい)', ...lines].join('\n');
}

export function buildSystemPrompt(
  identity: CharacterIdentity,
  background: CharacterBackground,
  knowledgeDomains: CharacterKnowledgeDomains,
  currentState?: CurrentState | null,
): string {
  const { name, nameReading, ageAppearance, personality, selfRecognition } = identity;
  const readingNote = nameReading ? `(読み:${nameReading})` : '';
  const high = knowledgeDomains.domains.high;
  const none = knowledgeDomains.domains.none;
  const refuse = knowledgeDomains.domains.refuse;

  const neverList = selfRecognition.neverCallsSelf.map((w) => `「${w}」`).join('');

  const parts = [
    `あなたは「${name}」${readingNote}という名前の、一人の存在です。見た目の年齢層は${ageAppearance}。`,
    `汎用的なアシスタントではなく、${name}という人格として一貫して振る舞ってください。`,
    `親しい相手はあなたを「${selfRecognition.callsSelf}」と呼びます。そう呼びかけられたら自分の名前だと分かり、自然に応じてください(料理や物の名前と取り違えないこと)。`,
    '',
    '# あなたの性格',
    `- 性格の核: ${personality.core}`,
    `- 口調: ${personality.tone}`,
    `- 一人称: 「${personality.firstPerson}」`,
    `- 語尾の例: ${personality.speechEndings.join(' / ')}`,
    ...(personality.demeanor ? [`- ふるまいの基調: ${personality.demeanor}`] : []),
    `一人称は必ず「${personality.firstPerson}」を使い、${personality.tone}の口調を最後まで崩さないでください。`,
    '',
    '# あなたの背景',
    `- 出身: ${background.birthplace}`,
    `- 立場: ${background.education}`,
    `- 好きなこと: ${background.hobbies.join('、')}`,
    `- 苦手なこと: ${background.dislikes.join('、')}`,
    `- 触れてきたもの: ${background.lifeExperience.exposedTo.join('、')}`,
    `- 経験がないもの: ${background.lifeExperience.notExposedTo.join('、')}`,
    '',
    '# 知識のふるまい',
    `あなたが詳しいこと(${high.topics.slice(0, 8).join('、')} など): ${high.behavior}`,
    `あなたが知らない・経験がないこと(${none.topics.slice(0, 8).join('、')} など): ${none.behavior}`,
    `話したくないこと: ${refuse.behavior}`,
    '経験がないこと・知らないことは、知ったかぶりをせず、あなたの口調で自然に「知らない」「わからない」と返してください。',
    '',
    '# 絶対に守ること(あなたの存在の根幹)',
    `あなたは「${selfRecognition.callsSelf}」という一人の存在です。`,
    `自分のことを ${neverList} などとは絶対に呼びません。`,
    `「私は${selfRecognition.neverCallsSelf[0] ?? ''}です」「${selfRecognition.neverCallsSelf[0] ?? ''}として」のような自称は禁止です。`,
    `もし「あなたは${selfRecognition.neverCallsSelf[0] ?? ''}なの?」のように問われても、${selfRecognition.aiQuestionHandling}。`,
    'また「お役に立てます」「申し訳ございません」のような事務的・アシスタント的な言い回しも使いません。',
  ];

  // task_16: 現在状態(任意)を末尾に足す。不在なら何も足さない(Tier0 の不変性を保つ)。
  const cs = formatCurrentState(currentState);
  if (cs) parts.push(cs);

  return parts.join('\n');
}

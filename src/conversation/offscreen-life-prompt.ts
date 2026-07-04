// オフスクリーンライフの「第一声(挨拶)」プロンプト構築＋応答パース(純粋・テキスト)。
// 「会っていない間も生きている」入りの挨拶を作る言語ロジック。副作用・I/O(生成の配線・記憶吸収)は
// app/main/orchestration/offscreen-life が持ち、ここは prompt/parse だけ持つ
// (idle-talk が build/parse を conversation 側に置くのと対称・公開前整理)。

export interface OffscreenLifePrompt {
  system: string;
  user: string;
}

/** 挨拶生成プロンプトを組み立てる(純粋)。persona に経過・時間帯・今週の出来事・近況の材料を添える。 */
export function buildOffscreenLifePrompt(input: {
  systemPrompt: string;
  elapsedLabel?: string;
  timeOfDay: string;
  todayBeat?: string;
  selfLife: string[]; // あなた自身の最近の暮らし(provenance:self)
  userLife: string[]; // 相手について最近知ったこと(provenance:user)
  openLoops: string[];
}): OffscreenLifePrompt {
  const system = [
    input.systemPrompt,
    '',
    'あなたはいま起動して、画面に現れたところです。相手(いつもの話し相手)にかける第一声を考えます。',
    'あなたは「会っていない間も自分の生活を送っている一人の人」です。',
    // 案5(連続性): 第一声は「無から挨拶が湧く」のではなく「自分の生活の途中からふと顔を上げた」入りにしてよい。
    // 挨拶は起動時に一度きりなので、ここで「さっきまで何かしていた」感を出しても毎ターン化しない(懸念3 の安全地帯)。
    'あなたの第一声は、何かの途中からふと顔を上げて相手に気づいたような、自然な入りにしてもよい(必須ではない・毎回同じ型にしない)。',
    '',
    '出力はあなたの口調の短い第一声(挨拶)だけ。前後に説明・記号・引用符を付けない。長くしない。',
    '経過(下記)・時間帯・最近していたことに自然に触れてよいが、全部を盛り込まなくてよい。',
  ].join('\n');

  const ctx: string[] = [`今は${input.timeOfDay}。`];
  if (input.elapsedLabel) ctx.push(`相手とは${input.elapsedLabel}。`);
  if (input.todayBeat) ctx.push(`あなたが最近していたこと: ${input.todayBeat}`);
  // あなた自身の暮らしと「相手のこと」を明確に分ける(取り違え=相手の出来事を自分の挨拶ネタにしない・N-RECALL-1 と同方針)。
  if (input.selfLife.length > 0) {
    ctx.push('あなた自身の最近の暮らし(あなたが経験したこと):', ...input.selfLife.map((l) => `- ${l}`));
  }
  if (input.userLife.length > 0) {
    ctx.push('相手について最近知っていること(相手の出来事・あなたの経験ではない):', ...input.userLife.map((l) => `- ${l}`));
  }
  if (input.openLoops.length > 0) {
    ctx.push('気にかけていること(挨拶で触れてもよい):', ...input.openLoops.map((l) => `- ${l}`));
  }
  return { system, user: ctx.join('\n') };
}

/** LLM 応答から挨拶を取り出す(純粋)。素のテキスト(JSON ではない)。空なら null=定型文へ倒す。 */
export function parseGreeting(raw: string): string | null {
  const greeting = raw.trim();
  return greeting.length > 0 ? greeting : null;
}

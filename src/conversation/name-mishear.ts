// STT の同音異字補正(§5.4 と同系統)。音声認識がキャラ名「callsSelf」を同じ読みの別表記
// (取り身・鳥身 等)へ誤変換する問題を、①プロンプトの読み替えヒント ②呼びかけ位置の決定論的な戻し
// ③記憶サマリ生成のラッパ、の3手で吸収する。検知綴りは identity.json から渡す(ハードコード禁止)。
// プロンプト構築(prompt-builder)とは別関心のため分離(公開前整理)。

/**
 * STT がキャラ名「callsSelf」を同音異字(取り身・鳥身 等)へ誤変換する問題への指示文を作る(§5.4 と同様、
 * 検知綴りは identity.json から渡す・ハードコード禁止)。機械置換はせず、唐突/不自然な文脈での誤変換を
 * Claude に**文脈で読み替え**させる。会話プロンプトと記憶サマリ(抽出/要約)の両方で使う。空なら指示を出さない。
 */
export function buildNameMishearHint(callsSelf: string, aliases: string[]): string {
  const list = aliases.filter(Boolean);
  if (!callsSelf || list.length === 0) return '';
  const quoted = list.map((a) => `「${a}」`).join('');
  return [
    `# 名前「${callsSelf}」の聞き取り(重要)`,
    `音声認識は固有名「${callsSelf}」を ${quoted} 等(同じ読み)へ誤変換します。`,
    `これらが呼びかけ・指し示しとして現れたら、**必ず**キャラクター名「${callsSelf}」のことと解釈し、`,
    `応答でも記録でも「${callsSelf}」と表記してください。誤変換に言及して「取り身?」のように聞き返さないこと。`,
    `ただし「鳥見に行く(野鳥観察)」のように明らかに別語の自然な文だけは、元の意味のまま扱います。`,
  ].join('\n');
}

/** LLM 呼び出し関数(memory の LlmComplete と同形)。型レイヤーを跨がないよう構造で表す。 */
type CompleteFn = (req: { system: string; user: string; maxTokens?: number }) => Promise<string>;

/**
 * STT が固有名「callsSelf」を同音異字(aliases)へ誤変換した分を、**呼びかけ位置(文全体/文頭/文末)に限って**
 * 決定論的に名前へ戻す。LLM の読み替えヒント(buildNameMishearHint)を補完し、Haiku 等で hint が効かず
 * 「鳥見?誰それ」になる取りこぼしを潰す。「鳥見に行く(野鳥観察)」のような文中の自然語は、境界(句読点/空白/終端)に
 * 隣接する呼びかけだけ戻すことで誤補正しない。
 */
export function correctVocativeName(text: string, callsSelf: string, aliases: string[]): string {
  const list = aliases.filter(Boolean);
  if (!callsSelf || list.length === 0) return text;
  const t = text.trim();
  if (!t) return text;
  const isBoundary = (c: string): boolean => c === '' || /[\s、。，．,.!?！？]/.test(c);
  for (const a of list) {
    if (t === a) return callsSelf; // 全体が誤変換名=呼びかけ
    if (t.startsWith(a) && isBoundary(t[a.length] ?? '')) return callsSelf + t.slice(a.length); // 文頭の呼びかけ
    if (t.endsWith(a) && isBoundary(t[t.length - a.length - 1] ?? '')) {
      return t.slice(0, t.length - a.length) + callsSelf; // 文末の呼びかけ
    }
  }
  return text;
}

/**
 * 記憶サマリ(抽出/期間要約)の LLM 呼び出しに、同音異字の読み替え指示を system へ前置きして包む。
 * short-term 以外の記憶(episodic/サマリ)に「取り身」等が焼き付かないようにする。hint が空なら素通し。
 */
export function withNameMishearHint<C extends CompleteFn>(complete: C, hint: string): C {
  if (!hint) return complete;
  return ((req) => complete({ ...req, system: `${req.system}\n\n${hint}` })) as C;
}

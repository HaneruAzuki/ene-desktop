// STT 名前補正(B-10 Part4 / N-LAT-? )。
//
// STT(whisper)は固有名詞の自称「トリミ」を「取り身」等に誤認しやすい。
// whisper のプロンプトバイアス(prompt_ids)は現行 transformers.js では generate() が
// 消費しない(実装上コメントアウト)ため使えない。→ **保守的な後処理**で補う。
//
// 方針(ユーザー判断・低リスク): **発話全体が名前エイリアス(=呼びかけ)のときだけ**
//   callsSelf(例「トリミ」)へ置換する。文中の「取り身」(魚の話など正当な語)は触らない=過補正回避。
// エイリアスはキャラ依存値として identity.json に外出し(§4.5・ハードコード禁止)。
//
// 純粋関数(I/O なし)=単体テスト対象。STT 経路(vad-runtime)でのみ適用し、テキスト入力には適用しない。

/** 末尾の句読点・感嘆/疑問・空白を分離する(「取り身！」→ core「取り身」/ trail「！」)。 */
const TRAILING_RE = /^([\s\S]*?)([、。.!?！？…・\s]*)$/;

/**
 * 発話全体が名前エイリアスのときだけ、自称(canonical)へ置換する。末尾の句読点は保持。
 * それ以外(文中にエイリアスを含む等)は元のまま返す=過補正しない。
 *
 * @param text STT の確定テキスト
 * @param aliases STT が誤認しやすい綴り(identity.sttAliases)
 * @param canonical 置換先の自称(identity.selfRecognition.callsSelf 等)
 */
export function correctNameMishear(text: string, aliases: string[], canonical: string): string {
  if (!canonical || aliases.length === 0) return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  const m = TRAILING_RE.exec(trimmed);
  const core = m?.[1] ?? trimmed;
  const trail = m?.[2] ?? '';
  if (aliases.includes(core)) return canonical + trail;
  return text;
}

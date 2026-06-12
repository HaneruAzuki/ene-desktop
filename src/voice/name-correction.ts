// STT 名前補正(B-10 Part4 / N-LAT-?)。
//
// STT(whisper)は固有名詞の自称「トリミ」を「取り身」「取り見」等に誤認しやすい。
// whisper のプロンプトバイアス(prompt_ids)は現行 transformers.js では generate() が
// 消費しない(実装上コメントアウト)ため使えない。→ **保守的な後処理**で補う。
//
// 方針(ユーザー判断・2026-06): **呼びかけ位置**(=トリミに話しかけている強い兆候)で自称へ置換する。
//  - 発話の**先頭**にエイリアスがあり、直後が句読点/空白/文末(例「取り見、今日ね」)
//  - 発話の**末尾**にエイリアスがあり、直前が句読点/空白(例「ねえ、取り身」)
// 文中の正当語(「メモを取り見直した」「鳥見に行く」等)は**触らない**=過補正回避。
// エイリアスはキャラ依存値として identity.json に外出し(§4.5・ハードコード禁止)。
//
// 純粋関数(I/O なし)=単体テスト対象。STT 経路(vad-runtime)でのみ適用し、テキスト入力には適用しない。

/** 呼びかけの区切りとみなす文字(句読点・感嘆/疑問・中黒・空白)。 */
const BOUNDARY = '[、。，,．.！!？?…・\\s]';

/** 正規表現メタ文字をエスケープ(エイリアスは通常メタ文字を含まないが安全側)。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 呼びかけ位置(先頭/末尾)のエイリアスだけを自称(canonical)へ置換する。文中の正当語は触らない。
 *
 * @param text STT の確定テキスト
 * @param aliases STT が誤認しやすい綴り(identity.sttAliases)
 * @param canonical 置換先の自称(identity.selfRecognition.callsSelf 等)
 */
export function correctNameMishear(text: string, aliases: string[], canonical: string): string {
  if (!canonical || aliases.length === 0) return text;
  // 長い綴りを先にして交替(部分一致の取りこぼし回避)。空文字は除外。
  const group = [...aliases]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  if (!group) return text;

  let out = text;
  // 先頭の呼びかけ:「(空白)綴り」のあとが 区切り or 文末。
  out = out.replace(new RegExp(`^(\\s*)(?:${group})(?=${BOUNDARY}|$)`), `$1${canonical}`);
  // 末尾の呼びかけ:「区切り のあとに 綴り」が文末(末尾の区切りは保持)。
  out = out.replace(new RegExp(`(${BOUNDARY})(?:${group})(${BOUNDARY}*)$`), `$1${canonical}$2`);
  return out;
}

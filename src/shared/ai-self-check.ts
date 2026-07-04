// AI自称検知(設計書 §3.4「AI自称防止の3層防御」第2層)。
//
// 検知対象の語(neverCallsSelf)は identity.json から、検知テンプレ(「私は{w}」等)は language.json から渡す。
// テンプレは言語依存(日本語文法)なのでコードに直書きせず外出しする(§4.5・コアを特定言語にロックしない)。

export interface AiSelfCheckResult {
  detected: boolean;
  matchedWord?: string;
  matchedPattern?: string;
}

/**
 * text に「自称パターン」が含まれるか。templates の {w} に neverCallsSelf の各語を当てて走査する。
 * 例:templates=["私は{w}"] × neverCallsSelf=["AI"] → 「私はAI」を検出。
 * templates は language.json 由来(言語依存)。空なら検知しない(=無効化)。
 */
export function detectAiSelfReference(
  text: string,
  neverCallsSelf: string[],
  templates: string[],
): AiSelfCheckResult {
  for (const word of neverCallsSelf) {
    for (const template of templates) {
      const pattern = template.replace('{w}', word);
      if (text.includes(pattern)) {
        return { detected: true, matchedWord: word, matchedPattern: pattern };
      }
    }
  }
  return { detected: false };
}

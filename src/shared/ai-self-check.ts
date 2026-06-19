// AI自称検知(設計書 §3.4「AI自称防止の4層防御」第2層)。
//
// 検知対象の語(neverCallsSelf)は identity.json から渡される(ハードコード禁止・CLAUDE §5.4)。
// 検知パターン(「私は{w}」等)はキャラ非依存なのでコードに定義する。

export interface AiSelfCheckResult {
  detected: boolean;
  matchedWord?: string;
  matchedPattern?: string;
}

// {w} に neverCallsSelf の各語を当てはめて自称パターンを生成する。
const PATTERN_TEMPLATES = [
  '私は{w}',
  '私が{w}',
  '自分は{w}',
  '自分が{w}',
  '{w}として',
  '{w}なので',
  '{w}ですが',
  '{w}には',
];

export function detectAiSelfReference(
  text: string,
  neverCallsSelf: string[],
): AiSelfCheckResult {
  for (const word of neverCallsSelf) {
    for (const template of PATTERN_TEMPLATES) {
      const pattern = template.replace('{w}', word);
      if (text.includes(pattern)) {
        return { detected: true, matchedWord: word, matchedPattern: pattern };
      }
    }
  }
  return { detected: false };
}

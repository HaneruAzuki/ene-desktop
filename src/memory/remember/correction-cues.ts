import type { EpisodicRecord } from '../../shared/types/memory';

// 訂正リーチの拡張(P4・斜めの訂正でも対象記憶へ届かせる)。純粋・I/O 無し。
//
// なぜ要るか(精査 a):抽出器が訂正できるのは「その会話で想起された記憶」だけ。話題から外れた訂正は対象が
// 想起されず直せない。そこでユーザーが訂正しているサインがある時だけ、想起の窓を広げ直近の言及を足して、
// 対象記憶を抽出器の視界へ入れる。
// ※ これは言語的な合図(一般語)であってキャラの個性ではない。合図語は language.json の correctionCues から
//   渡す(§4.5 外出し・コアを特定言語にロックしないため)。常用の曖昧語(「〜じゃない」単独 等)は含めない。
//
// 誤検知のコスト:抽出は応答経路の外。合図の空振り=抽出器へ渡す関連記憶が少し増えるだけで、害は無い
// (訂正するか否かは最終的に LLM が判断する)。よって取りこぼしを減らす方向に倒し、合図はやや広めに採る。

/** 会話文に訂正の合図(language.json の correctionCues のいずれか)が含まれるか。 */
export function hasCorrectionCue(text: string, cues: string[]): boolean {
  return cues.some((cue) => text.includes(cue));
}

/**
 * base(想起結果)に、直近の user 記録を最大 n 件まで重複なく足す(P4)。
 * 想起(話題依存)では拾えない「少し前に言った別件」を抽出器の視界へ入れるための補強。
 * canon(self)・supersede 済みは除く。date 降順で新しいものから。
 */
export function augmentWithRecent(
  base: EpisodicRecord[],
  userRecords: EpisodicRecord[],
  n: number,
): EpisodicRecord[] {
  const seen = new Set(base.map((r) => r.id));
  const recent = userRecords
    .filter((r) => !seen.has(r.id) && r.memory.provenance !== 'self' && !r.memory.supersededBy)
    .sort((a, b) => b.memory.date.localeCompare(a.memory.date))
    .slice(0, n);
  return [...base, ...recent];
}

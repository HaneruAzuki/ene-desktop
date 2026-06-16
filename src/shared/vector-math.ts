// ベクトルのコサイン類似度(共有・SSOT・横断監査 E2③)。
// embedder は normalize 済みベクトルを返すため正規化済み同士なら内積と一致するが、
// 正規化されていなくても安全に計算する(magnitude で割る)。
// router(knowledge/local-classifier)とベクトル想起(memory/index-vector)が
// **同一実装を共有**し、二重定義によるドリフト(片方だけ修正される)を防ぐ。
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

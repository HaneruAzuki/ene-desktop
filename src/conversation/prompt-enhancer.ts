import type { SystemBlock } from '../shared/types/conversation';

// 第3防御(再生成)用のプロンプト強化(設計書 §3.4 / task_14)。
// 強化文は **非キャッシュの追加ブロック** として末尾に足す(Tier0 の不変性=キャッシュを壊さない)。

export function enhancePromptForRegeneration(
  originalSystem: SystemBlock[],
  detectedWord: string,
): SystemBlock[] {
  const enhancement: SystemBlock = {
    type: 'text',
    text: [
      '# 重要(再生成指示)',
      `前回の応答に「${detectedWord}」という自称が含まれていました。`,
      'あなたはそのような存在ではありません。キャラクターとして、自称を避けて応答し直してください。',
    ].join('\n'),
  };
  return [...originalSystem, enhancement];
}

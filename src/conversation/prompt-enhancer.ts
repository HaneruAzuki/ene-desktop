// 第3防御(再生成)用のプロンプト強化(設計書 §3.4)。

export function enhancePromptForRegeneration(
  originalSystem: string,
  detectedWord: string,
): string {
  return [
    originalSystem,
    '',
    '# 重要(再生成指示)',
    `前回の応答に「${detectedWord}」という自称が含まれていました。`,
    'あなたはそのような存在ではありません。キャラクターとして、自称を避けて応答し直してください。',
  ].join('\n');
}

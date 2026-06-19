// LLM 呼び出しの port(依存性逆転の境界・05_architecture §4)。
//
// memory 層は Claude を直接知らない。memory はこの port を受け取り(DI)、
// Conversation 層が実装(makeLlmComplete)を注入する。ドメイン間で共有する型契約なので
// shared/types に置く(旧:memory/extractor.ts に同居していた port を移設・N-ARCH-5)。

/** LLM へ 1 回問い合わせて生テキストを返す関数(Conversation 層が実装を注入)。 */
export type LlmComplete = (req: {
  system: string;
  user: string;
  maxTokens?: number;
}) => Promise<string>;

/* ESLint 設定(ESLint 8 系・レガシー設定形式)。
 * CLAUDE.md §8 のコーディング規約を機械的に担保する。 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['out/', 'dist/', 'node_modules/', 'data/', 'electron.vite.config.ts'],
  rules: {
    // CLAUDE.md §8.1: any 型は原則禁止
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // CLAUDE.md §4.5/§5.1: ドメイン層(character/knowledge/memory/conversation/voice)と
      // 土台 shared はキャラ非依存。固有名・性格を**文字列リテラルに埋め込まない**
      // (キャラ依存値は {id}/*.json へ外出しする)。コメントでの言及は対象外(=挙動に埋め込んでいない)。
      // UI 文言(app/renderer)は製品の固定キャラ名のため対象外(外出しは positioning §10=別スコープ)。
      files: [
        'src/character/**/*.ts',
        'src/knowledge/**/*.ts',
        'src/memory/**/*.ts',
        'src/conversation/**/*.ts',
        'src/voice/**/*.ts',
        'src/shared/**/*.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'Literal[value=/魚川トリミ|トリミ|ツンデレ/]',
            message:
              'キャラ固有名・性格をドメイン/shared 層の文字列リテラルに埋め込まない(CLAUDE.md §5.1)。値は {id}/*.json へ外出しする。',
          },
          {
            selector: 'TemplateElement[value.raw=/魚川トリミ|トリミ|ツンデレ/]',
            message:
              'キャラ固有名・性格をドメイン/shared 層の文字列(テンプレート)に埋め込まない(CLAUDE.md §5.1)。値は {id}/*.json へ外出しする。',
          },
        ],
      },
    },
  ],
};

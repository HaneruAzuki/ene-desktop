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
};

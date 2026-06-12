/**
 * dependency-cruiser 設定 — アーキテクチャ境界を機械的に担保する(dev専用・配布物に含まれない)。
 *
 * 守るルールの正本は docs/05_architecture.md §4「依存の向き」/ CLAUDE.md §4.4「疎結合 > 集約」。
 * 体(フォルダ)= ドメイン名詞(character/knowledge/memory/conversation/voice)＋土台(app/shared)。
 * 依存は **app → ドメイン → shared** の一方向。逆流(ドメイン→app、shared→上位)を error で禁止する。
 *
 * 実行: `npm run lint:deps`(TypeScript は tsconfig 経由でネイティブ解決)。
 */
module.exports = {
  forbidden: [
    {
      name: 'no-domain-to-app',
      comment:
        'ドメイン層(character/knowledge/memory/conversation/voice)は土台 app/ に依存しない。' +
        '組み立て(配線)は app/main が一方向に行う(05_architecture §4)。',
      severity: 'error',
      from: { path: '^src/(character|knowledge|memory|conversation|voice)/' },
      to: { path: '^src/app/' },
    },
    {
      name: 'no-shared-to-upper',
      comment:
        'shared は最下層の土台(プロセス非依存の型・ユーティリティ)。app やドメイン層へ依存しない' +
        '(05_architecture §4)。Electron 接触は shared/node/ に閉じる。',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/(app|character|knowledge|memory|conversation|voice)/' },
    },
    {
      name: 'no-circular',
      comment: '循環依存を禁止(疎結合・CLAUDE.md §4.4)。',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // 型のみの import も依存として解析する(TS の boundary を正しく見る)。
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};

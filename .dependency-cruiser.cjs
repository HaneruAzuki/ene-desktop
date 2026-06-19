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
      name: 'no-index-impl-outside-memory',
      comment:
        'memory の索引実装(index-inverted / index-vector)は episodic 本体から再生成できる' +
        '派生キャッシュ=内部実装。memory 層の外は公開窓口(retriever / episodic-write)経由で使い、' +
        '索引実装へ直接依存しない。これが §4.4 の旗艦例「検索方式を変えても上位は無変更」を' +
        '機械的に担保する(宣言だけの疎結合を実体にする)。',
      severity: 'error',
      from: { pathNot: '^src/memory/' },
      to: { path: '^src/memory/index-(inverted|vector)' },
    },
    {
      name: 'no-episodic-store-outside-memory',
      comment:
        'memory の中期記憶ストア(episodic.ts)は読み書きのプリミティブ。memory 層の外は公開 facade' +
        '(context-builder / presence-reads / episodic-write 等)経由で使い、ストア実装(全件ロード等)へ' +
        '直接依存しない。書き込み側 no-index-impl-outside-memory と対称に、読み取り側も §4.4 を担保する。',
      severity: 'error',
      from: { pathNot: '^src/memory/' },
      to: { path: '^src/memory/episodic\\.ts$' },
    },
    {
      name: 'no-cross-domain',
      comment:
        'ドメイン(character/knowledge/memory/conversation/voice)は互いに直接依存しない。' +
        'ドメイン間の通信は shared/types の型契約・DI(LlmComplete 等)を介し、組み立て(配線)は' +
        'app/main が一方向に行う(05_architecture §4 の理想を宣言から機械強制へ格上げ・N-ARCH-5)。' +
        '例外は memory → character/active-character のみ:character は他ドメインに依存しない leaf で、' +
        'memory が関係の事実(relationship facts)を読むための良性の下向き依存として意図的に許可する。',
      severity: 'error',
      from: { path: '^src/(character|knowledge|memory|conversation|voice)/' },
      to: {
        path: '^src/(character|knowledge|memory|conversation|voice)/',
        pathNot: [
          '^src/$1/', // 同一ドメイン内の依存は当然OK($1 は from で捕捉したドメイン名)
          '^src/character/active-character', // 例外: memory→character(active-character)= 良性 leaf 依存
        ],
      },
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

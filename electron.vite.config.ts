import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// electron-vite 設定。main / preload / renderer の 3 ビルドを定義する。
// React は @vitejs/plugin-react を追加せず、esbuild の automatic JSX 変換で扱う
// (設計書 §1.2 に記載のないライブラリを増やさないため・CLAUDE.md §2.3)。
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        // 埋め込みランタイムは ESM＋ネイティブ依存(onnxruntime-node の .node)を含むため
        // バンドルせず外部化する。実行時に node_modules から解決し、native は asarUnpack で同梱する
        // (electron-builder.yml)。Phase B(task_15)。
        external: ['@huggingface/transformers', 'onnxruntime-node'],
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // APIキーダイアログ専用 preload(out/preload/api-key-dialog.js)
          'api-key-dialog': resolve(__dirname, 'src/preload/api-key-dialog-preload.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // APIキーダイアログ専用ページ(out/renderer/api-key-dialog/index.html)
          apiKeyDialog: resolve(__dirname, 'src/renderer/api-key-dialog/index.html'),
        },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
      // three は単一インスタンスに集約する。three と @pixiv/three-vrm が別コピーの three を
      // 掴むと MToon マテリアルの instanceof 判定が壊れ、テクスチャが当たらず真っ白に描画される(F)。
      dedupe: ['three'],
    },
    // dev のesbuild事前バンドルでも three/three-vrm を同一に解決させる(白化防止)。
    optimizeDeps: { include: ['three', '@pixiv/three-vrm'] },
    esbuild: { jsx: 'automatic' },
  },
});

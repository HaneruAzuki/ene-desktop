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
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    esbuild: { jsx: 'automatic' },
  },
});

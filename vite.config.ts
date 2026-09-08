import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名がサブパスになる。
// 環境変数 BASE_PATH（CI で設定）が無ければ相対パスで動くようにする。
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
});

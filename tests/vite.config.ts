import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** determinism.ts を Node で実行できる 1 ファイルに束ねるための設定。 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  build: {
    ssr: true,
    target: 'node22',
    outDir: fileURLToPath(new URL('../.testout', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: [
        fileURLToPath(new URL('./determinism.ts', import.meta.url)),
        fileURLToPath(new URL('./balance.ts', import.meta.url)),
        fileURLToPath(new URL('./measure.ts', import.meta.url)),
      ],
      output: { entryFileNames: '[name].mjs' },
    },
  },
});

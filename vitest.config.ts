import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'jsdom', exclude: ['e2e/**', 'node_modules/**', '.claude/**'], setupFiles: ['./src/test/setup.ts'], coverage: { reporter: ['text', 'html'], include: ['src/core/**/*.ts', 'src/editor/**/*.ts'] } },
});

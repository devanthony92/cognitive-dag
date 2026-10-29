import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Integration files share Valkey counters and the database: run them one at a time.
    fileParallelism: false,
  },
  // SWC emits the decorator metadata that NestJS dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});

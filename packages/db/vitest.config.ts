import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ['./test/setup.ts'],
  },
});

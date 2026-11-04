import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/chaos/**/*.chaos.test.ts'],
    // Every test breaks shared infrastructure (Temporal, Valkey, PostgreSQL): one at a time.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});

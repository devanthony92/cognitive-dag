import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Starting the Temporal test server and bundling workflows is slow on CI runners.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each file may start its own Temporal test server: in parallel they miss the 5 s start limit.
    fileParallelism: false,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Starting the Temporal test server and bundling workflows is slow on CI runners.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

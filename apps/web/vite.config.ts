import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The router plugin must run before the React plugin.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  // Read VITE_* variables from the repository-level .env.
  envDir: '../../',
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  test: {
    environment: 'jsdom',
    // `turbo run test` runs every package at once, so this suite must not take all the cores or
    // wait the 5 s default of Vitest under that load (F8, SC-007; measured in T002).
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

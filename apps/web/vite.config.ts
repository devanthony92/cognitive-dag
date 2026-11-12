import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  // The router plugin must run before the React plugin.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  // Read VITE_* variables from the repository-level .env.
  envDir: '../../',
  // A production build ignores the development `.env` (F9, FR-006): the API shares the origin, so
  // `VITE_API_URL` is empty and every path is relative, and the image does not depend on the domain.
  // Only a variable set in the build environment itself can change it. The demo notice is on by
  // default in a production build and is switched off with `VITE_DEMO_NOTICE=false`.
  define:
    command === 'build'
      ? {
          'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL ?? ''),
          'import.meta.env.VITE_DEMO_NOTICE': JSON.stringify(
            process.env.VITE_DEMO_NOTICE ?? 'true',
          ),
        }
      : {},
  build: {
    // Fonts must stay files: Vite would inline small assets as `data:` URIs and the production CSP
    // (`font-src 'self'`) blocks them (F10, research R3).
    assetsInlineLimit: 0,
  },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  test: {
    environment: 'jsdom',
    // `turbo run test` runs every package at once, so this suite must not take all the cores or
    // wait the 5 s default of Vitest under that load (F8, SC-007; measured in T002).
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));

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
  test: { environment: 'jsdom' },
});

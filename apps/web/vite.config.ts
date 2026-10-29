import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Read VITE_* variables from the repository-level .env.
  envDir: '../../',
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  test: { environment: 'jsdom' },
});

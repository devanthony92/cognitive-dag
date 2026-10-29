import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the repository-level .env during local development. Production reads the real env. */
export function loadLocalEnv(): void {
  if (process.env.NODE_ENV === 'production') return;
  const envFile = resolve(process.cwd(), '../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

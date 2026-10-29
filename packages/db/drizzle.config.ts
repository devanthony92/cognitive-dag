import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Migrations run as app_migrator (research R9). Locally the URL comes from the repository .env.
const envFile = resolve(process.cwd(), '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) throw new Error('DATABASE_MIGRATOR_URL is required to run migrations.');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});

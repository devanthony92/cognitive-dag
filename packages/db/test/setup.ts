import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Integration tests read the connection strings from the repository .env (or the CI environment).
const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * Migration runner of the `migrator` image (F9, FR-026). It uses drizzle-orm's migrator, which keeps
 * the same journal as drizzle-kit (`drizzle.__drizzle_migrations`), so the image needs neither
 * drizzle-kit nor esbuild. Works from `src` and from `dist`: the folder sits next to both.
 */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies every pending migration, then closes the connection. Rejects on any failure. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  pool.on('error', () => undefined);
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

export interface CliOutput {
  log(line: string): void;
  error(line: string): void;
}

/**
 * Reads `DATABASE_MIGRATOR_URL` and, in production, the password from `DATABASE_PASSWORD_FILE`.
 * Returns the exit code. Messages name variables only: never a value, never the driver's text,
 * because a connection error can echo the URL.
 */
export async function runCli(env: NodeJS.ProcessEnv, out: CliOutput): Promise<number> {
  const raw = env.DATABASE_MIGRATOR_URL?.trim();
  if (!raw || !URL.canParse(raw)) {
    out.error('Invalid configuration: DATABASE_MIGRATOR_URL');
    return 1;
  }
  const url = new URL(raw);
  const passwordFile = env.DATABASE_PASSWORD_FILE?.trim();
  if (passwordFile) {
    try {
      url.password = readFileSync(passwordFile, 'utf8').replace(/\r?\n$/, '');
    } catch {
      out.error('Invalid configuration: DATABASE_PASSWORD_FILE');
      return 1;
    }
  }
  try {
    await runMigrations(url.toString());
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    out.error(`Migration failed${typeof code === 'string' ? ` (${code})` : ''}.`);
    return 1;
  }
  out.log('Migrations applied.');
  return 0;
}

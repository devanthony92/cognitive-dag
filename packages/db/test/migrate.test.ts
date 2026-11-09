import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runCli, runMigrations } from '../src/migrate.js';
import { requireEnv } from './helpers.js';

/**
 * F9 (FR-026): the migrator image applies the migrations with drizzle-orm, not drizzle-kit, and
 * must leave the same journal. Runs against a scratch database so it never touches the dev data.
 */
const base = new URL(requireEnv('DATABASE_MIGRATOR_URL'));
const scratch = `migrate_test_${Date.now().toString(36)}`;

function urlFor(user: string, password: string | null): string {
  const url = new URL(base);
  url.username = user;
  url.password = password ?? '';
  url.pathname = `/${scratch}`;
  return url.toString();
}

const admin = new pg.Pool({
  connectionString: (() => {
    const url = new URL(base);
    url.username = process.env.POSTGRES_USER ?? 'cognitive_dag';
    url.password = process.env.POSTGRES_PASSWORD ?? 'local_dev_only';
    url.pathname = '/postgres';
    return url.toString();
  })(),
  max: 1,
});
const migratorUrl = urlFor('app_migrator', 'app_migrator_dev_only');
let directory: string;

beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${scratch}`);
  const inside = new pg.Pool({
    connectionString: urlFor(
      process.env.POSTGRES_USER ?? 'cognitive_dag',
      process.env.POSTGRES_PASSWORD ?? 'local_dev_only',
    ),
    max: 1,
  });
  // Same grants as infra/postgres/init, for the scratch database.
  await inside.query(`GRANT CONNECT, CREATE ON DATABASE ${scratch} TO app_migrator`);
  await inside.query(`GRANT CONNECT ON DATABASE ${scratch} TO app_runtime`);
  await inside.query('ALTER SCHEMA public OWNER TO app_migrator');
  await inside.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await inside.query('GRANT USAGE ON SCHEMA public TO app_runtime');
  await inside.end();
  directory = mkdtempSync(join(tmpdir(), 'migrate-'));
});

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await admin.end();
  rmSync(directory, { recursive: true, force: true });
});

async function count(sql: string): Promise<number> {
  const pool = new pg.Pool({ connectionString: migratorUrl, max: 1 });
  try {
    return Number((await pool.query<{ n: string }>(sql)).rows[0]?.n);
  } finally {
    await pool.end();
  }
}

describe('runMigrations', () => {
  it('applies every migration to an empty database and is idempotent', async () => {
    await runMigrations(migratorUrl);
    const first = await count('SELECT count(*) AS n FROM drizzle.__drizzle_migrations');
    expect(first).toBeGreaterThan(0);
    expect(
      await count("SELECT count(*) AS n FROM pg_tables WHERE tablename = 'organizations'"),
    ).toBe(1);
    await runMigrations(migratorUrl);
    expect(await count('SELECT count(*) AS n FROM drizzle.__drizzle_migrations')).toBe(first);
  });

  it('uses the migrations folder of the package', () => {
    expect(migrationsFolder).toMatch(/migrations$/);
  });

  it('fails with a rejected promise when the database is unreachable', async () => {
    await expect(runMigrations('postgres://u:p@127.0.0.1:1/none')).rejects.toBeTruthy();
  });
});

describe('runCli', () => {
  const quiet = { log: () => undefined, error: () => undefined };

  it('exits 1 and names the variable when DATABASE_MIGRATOR_URL is missing', async () => {
    const lines: string[] = [];
    const code = await runCli({}, { log: () => undefined, error: (line) => lines.push(line) });
    expect(code).toBe(1);
    expect(lines.join(' ')).toContain('DATABASE_MIGRATOR_URL');
  });

  it('reads the password from DATABASE_PASSWORD_FILE and exits 0', async () => {
    const file = join(directory, 'password');
    writeFileSync(file, 'app_migrator_dev_only\n');
    const withoutPassword = urlFor('app_migrator', null);
    const code = await runCli(
      { DATABASE_MIGRATOR_URL: withoutPassword, DATABASE_PASSWORD_FILE: file },
      quiet,
    );
    expect(code).toBe(0);
  });

  it('exits 1 without printing the password when the connection fails', async () => {
    const lines: string[] = [];
    const url = 'postgres://app_migrator:super-secret-value@127.0.0.1:1/none';
    const code = await runCli(
      { DATABASE_MIGRATOR_URL: url },
      { log: (line) => lines.push(line), error: (line) => lines.push(line) },
    );
    expect(code).toBe(1);
    expect(lines.join(' ')).not.toContain('super-secret-value');
  });
});

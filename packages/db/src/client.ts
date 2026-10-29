import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';
import { createWithContext, type Database, type WithContext } from './tenant.js';

export interface DatabaseOptions {
  connectionString: string;
  max?: number;
  /** Connection and statement limits (constitution, principle II). */
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

export interface DatabaseClient {
  pool: pg.Pool;
  db: Database;
  withContext: WithContext;
  end(): Promise<void>;
}

export function createDatabase(options: DatabaseOptions): DatabaseClient {
  const statementTimeout = options.statementTimeoutMs ?? 10_000;
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 3_000,
    statement_timeout: statementTimeout,
    query_timeout: statementTimeout + 2_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // A restart of the database must not crash the process through an unhandled pool error.
  pool.on('error', () => undefined);
  const db = drizzle(pool, { schema });
  return { pool, db, withContext: createWithContext(db), end: () => pool.end() };
}

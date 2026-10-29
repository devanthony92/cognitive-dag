import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

/** Transaction handle given to `withContext` callbacks. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Row-level security context (research R8). `lookupTokenHash` is the hex SHA-256 of an opaque
 * token; `lookupEmail` is a normalized email. Only the authentication code sets the lookup keys.
 */
export interface TenantContext {
  userId?: string;
  organizationId?: string;
  lookupEmail?: string;
  lookupTokenHash?: string;
}

const SETTING_NAMES: Record<keyof TenantContext, string> = {
  userId: 'app.user_id',
  organizationId: 'app.organization_id',
  lookupEmail: 'app.lookup_email',
  lookupTokenHash: 'app.lookup_token_hash',
};

/** Adds keys to the context of the running transaction (e.g. the user id found by a lookup). */
export type ExtendContext = (extra: TenantContext) => Promise<void>;

async function applyContext(tx: Tx, context: TenantContext): Promise<void> {
  for (const key of Object.keys(SETTING_NAMES) as (keyof TenantContext)[]) {
    const value = context[key];
    if (value !== undefined) {
      // is_local = true: the setting dies with the transaction and never leaks to the pool.
      await tx.execute(sql`SELECT set_config(${SETTING_NAMES[key]}, ${value}, true)`);
    }
  }
}

/**
 * Runs `fn` in a transaction whose row-level security context is `context`. The API never queries
 * outside this function, so a query without context sees no rows.
 */
export function createWithContext(db: Database) {
  return function withContext<T>(
    context: TenantContext,
    fn: (tx: Tx, extend: ExtendContext) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await applyContext(tx, context);
      return fn(tx, (extra) => applyContext(tx, extra));
    });
  };
}

export type WithContext = ReturnType<typeof createWithContext>;

/** Generates an id before the INSERT, so a row can be referenced by the context it needs (R8). */
export async function newId(tx: Tx): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`SELECT uuidv7() AS id`);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('uuidv7() returned no row');
  return id;
}

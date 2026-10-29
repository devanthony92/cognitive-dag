import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

export interface TestContext {
  userId?: string;
  organizationId?: string;
  lookupEmail?: string;
  lookupTokenHash?: string;
}

const KEYS: Record<keyof TestContext, string> = {
  userId: 'app.user_id',
  organizationId: 'app.organization_id',
  lookupEmail: 'app.lookup_email',
  lookupTokenHash: 'app.lookup_token_hash',
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (docker compose up and cp .env.example .env)`);
  return value;
}

/** Pool connected as app_runtime: the only role the API uses. */
export function runtimePool(): pg.Pool {
  return new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 4 });
}

/** Pool connected as app_migrator, used only to inspect catalogs. */
export function migratorPool(): pg.Pool {
  return new pg.Pool({ connectionString: requireEnv('DATABASE_MIGRATOR_URL'), max: 2 });
}

/** Runs `fn` in a transaction with the RLS context set the way `withContext` does. */
export async function inContext<T>(
  pool: pg.Pool,
  context: TestContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, setting] of Object.entries(KEYS) as [keyof TestContext, string][]) {
      const value = context[key];
      if (value !== undefined)
        await client.query('SELECT set_config($1, $2, true)', [setting, value]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function unique(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

export function hashBytes(): Buffer {
  return randomBytes(32);
}

async function newId(client: pg.PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>('SELECT uuidv7() AS id');
  return rows[0]!.id;
}

export interface Tenant {
  userId: string;
  email: string;
  organizationId: string;
  membershipId: string;
}

/** What registration does: user, personal organization and owner membership in one transaction. */
export async function createTenant(pool: pg.Pool, label = 'tenant'): Promise<Tenant> {
  const email = `${unique(label)}@example.test`;
  return inContext(pool, {}, async (client) => {
    const userId = await newId(client);
    const organizationId = await newId(client);
    const membershipId = await newId(client);
    await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      KEYS.userId,
      userId,
      KEYS.organizationId,
      organizationId,
    ]);
    await client.query(
      'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
      [userId, email, label, '$argon2id$test'],
    );
    await client.query(
      'INSERT INTO organizations (id, name, is_personal, created_by) VALUES ($1, $2, true, $3)',
      [organizationId, `Personal ${label}`, userId],
    );
    await client.query(
      "INSERT INTO memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
      [membershipId, organizationId, userId],
    );
    return { userId, email, organizationId, membershipId };
  });
}

/** A second, non-personal organization owned by the given user. */
export async function createSharedOrganization(
  pool: pg.Pool,
  ownerId: string,
): Promise<{ organizationId: string; membershipId: string }> {
  return inContext(pool, { userId: ownerId }, async (client) => {
    const organizationId = await newId(client);
    const membershipId = await newId(client);
    await client.query('SELECT set_config($1, $2, true)', [KEYS.organizationId, organizationId]);
    await client.query(
      'INSERT INTO organizations (id, name, is_personal, created_by) VALUES ($1, $2, false, $3)',
      [organizationId, unique('org'), ownerId],
    );
    await client.query(
      "INSERT INTO memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
      [membershipId, organizationId, ownerId],
    );
    return { organizationId, membershipId };
  });
}

/** Adds a user to an organization with the given role; returns the membership id. */
export async function addMember(
  pool: pg.Pool,
  organizationId: string,
  role: 'owner' | 'editor' | 'viewer',
  label = 'member',
): Promise<{ userId: string; membershipId: string }> {
  return inContext(pool, { organizationId }, async (client) => {
    const userId = await newId(client);
    const membershipId = await newId(client);
    await client.query(
      'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
      [userId, `${unique(label)}@example.test`, label, '$argon2id$test'],
    );
    await client.query(
      'INSERT INTO memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)',
      [membershipId, organizationId, userId, role],
    );
    return { userId, membershipId };
  });
}

export async function expectSqlError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { code?: string }).code;
    if (actual !== code)
      throw new Error(`Expected SQLSTATE ${code}, got ${String(actual)}`, { cause: error });
    return;
  }
  throw new Error(`Expected SQLSTATE ${code}, but the statement succeeded`);
}

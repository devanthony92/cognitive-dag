import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createSharedOrganization,
  createTenant,
  expectSqlError,
  hashBytes,
  inContext,
  runtimePool,
  type Tenant,
} from './helpers.js';

const TABLES = [
  'users',
  'organizations',
  'memberships',
  'sessions',
  'one_time_tokens',
  'invitations',
] as const;

const INSUFFICIENT_PRIVILEGE = '42501';

let pool: pg.Pool;
let a: Tenant;
let b: Tenant;
const sessionHashA = hashBytes();
const tokenHashA = hashBytes();
const tokenHashB = hashBytes();
const invitationHashB = hashBytes();

async function count(client: pg.PoolClient, table: string, where = 'true'): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  pool = runtimePool();
  a = await createTenant(pool, 'rls-a');
  b = await createTenant(pool, 'rls-b');

  await inContext(pool, { userId: a.userId }, async (client) => {
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, ip, expires_at)
       VALUES ($1, $2, $3, '203.0.113.7', now() + interval '12 hours')`,
      [a.userId, sessionHashA, hashBytes()],
    );
    await client.query(
      `INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, 'email_verification', $2, now() + interval '24 hours')`,
      [a.userId, tokenHashA],
    );
  });
  await inContext(pool, { userId: b.userId, organizationId: b.organizationId }, async (client) => {
    await client.query(
      `INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, 'password_reset', $2, now() + interval '30 minutes')`,
      [b.userId, tokenHashB],
    );
    await client.query(
      `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, 'invited-b@example.test', 'viewer', $2, $3, now() + interval '7 days')`,
      [b.organizationId, invitationHashB, b.userId],
    );
  });
});

afterAll(async () => {
  await pool.end();
});

describe('role app_runtime', () => {
  it('cannot bypass row-level security or administer the database', async () => {
    const { rows } = await pool.query<Record<string, boolean>>(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  it('is not the owner of the tables and cannot change the schema', async () => {
    await expectSqlError(
      pool.query('CREATE TABLE should_not_exist (id int)'),
      INSUFFICIENT_PRIVILEGE,
    );
    await expectSqlError(
      pool.query('ALTER TABLE users DISABLE ROW LEVEL SECURITY'),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('has row-level security enabled and forced on every table', async () => {
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`,
      [TABLES],
    );
    expect(rows).toHaveLength(TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
  });
});

describe('without context', () => {
  it.each(TABLES)('sees 0 rows of %s', async (table) => {
    await inContext(pool, {}, async (client) => {
      expect(await count(client, table)).toBe(0);
    });
  });

  it('treats empty settings like no context (they revert to empty text after a transaction)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id', $1, true)", [a.userId]);
      await client.query('COMMIT');
      // Same session: app.user_id is now '' (not NULL). The policies must not error or match.
      await client.query('BEGIN');
      for (const table of TABLES) expect(await count(client, table), table).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('rejects inserts that need a context', async () => {
    const statements: [string, string, unknown[]][] = [
      [
        'organizations',
        "INSERT INTO organizations (name, created_by) VALUES ('x', $1)",
        [a.userId],
      ],
      [
        'memberships',
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'viewer')",
        [a.organizationId, a.userId],
      ],
      [
        'sessions',
        `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, ip, expires_at)
         VALUES ($1, $2, $3, '203.0.113.7', now())`,
        [a.userId, hashBytes(), hashBytes()],
      ],
      [
        'one_time_tokens',
        `INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at)
         VALUES ($1, 'password_reset', $2, now())`,
        [a.userId, hashBytes()],
      ],
      [
        'invitations',
        `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, 'x@example.test', 'viewer', $2, $3, now())`,
        [a.organizationId, hashBytes(), a.userId],
      ],
    ];
    for (const [table, sql, params] of statements) {
      await expect(
        inContext(pool, {}, (client) => client.query(sql, params)),
        table,
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    }
  });
});

describe('with the context of organization A', () => {
  const context = () => ({ userId: a.userId, organizationId: a.organizationId });

  it('reads its own rows', async () => {
    await inContext(pool, context(), async (client) => {
      expect(await count(client, 'users', `id = '${a.userId}'`)).toBe(1);
      expect(await count(client, 'organizations', `id = '${a.organizationId}'`)).toBe(1);
      expect(await count(client, 'memberships', `id = '${a.membershipId}'`)).toBe(1);
      expect(await count(client, 'sessions')).toBe(1);
      expect(await count(client, 'one_time_tokens')).toBe(1);
    });
  });

  it.each(TABLES)('reads 0 rows of %s that belong to B', async (table) => {
    const owner: Record<string, string> = {
      users: `id = '${b.userId}'`,
      organizations: `id = '${b.organizationId}'`,
      memberships: `organization_id = '${b.organizationId}'`,
      sessions: `user_id = '${b.userId}'`,
      one_time_tokens: `user_id = '${b.userId}'`,
      invitations: `organization_id = '${b.organizationId}'`,
    };
    await inContext(pool, context(), async (client) => {
      expect(await count(client, table, owner[table])).toBe(0);
    });
  });

  it('rejects inserting a membership into B', async () => {
    await expectSqlError(
      inContext(pool, context(), (client) =>
        client.query(
          "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
          [b.organizationId, a.userId],
        ),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('rejects inserting an invitation into B', async () => {
    await expectSqlError(
      inContext(pool, context(), (client) =>
        client.query(
          `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
           VALUES ($1, 'z@example.test', 'owner', $2, $3, now() + interval '7 days')`,
          [b.organizationId, hashBytes(), a.userId],
        ),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('rejects creating an organization on behalf of another user', async () => {
    await expectSqlError(
      inContext(pool, context(), (client) =>
        client.query("INSERT INTO organizations (name, created_by) VALUES ('x', $1)", [b.userId]),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('rejects writing a session for another user', async () => {
    await expectSqlError(
      inContext(pool, context(), (client) =>
        client.query(
          `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, ip, expires_at)
           VALUES ($1, $2, $3, '203.0.113.7', now())`,
          [b.userId, hashBytes(), hashBytes()],
        ),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('updates 0 rows of B', async () => {
    await inContext(pool, context(), async (client) => {
      const org = await client.query("UPDATE organizations SET name = 'hijack' WHERE id = $1", [
        b.organizationId,
      ]);
      const user = await client.query("UPDATE users SET name = 'hijack' WHERE id = $1", [b.userId]);
      const member = await client.query("UPDATE memberships SET role = 'viewer' WHERE id = $1", [
        b.membershipId,
      ]);
      expect([org.rowCount, user.rowCount, member.rowCount]).toEqual([0, 0, 0]);
    });
  });

  it('cannot move its own membership into B', async () => {
    await expectSqlError(
      inContext(pool, context(), (client) =>
        client.query('UPDATE memberships SET organization_id = $1 WHERE id = $2', [
          b.organizationId,
          a.membershipId,
        ]),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('updates its own organization', async () => {
    await inContext(pool, context(), async (client) => {
      const result = await client.query("UPDATE organizations SET name = 'Renamed' WHERE id = $1", [
        a.organizationId,
      ]);
      expect(result.rowCount).toBe(1);
    });
  });
});

describe('lookup context keys', () => {
  it('finds a user by email but no other table', async () => {
    await inContext(pool, { lookupEmail: a.email }, async (client) => {
      expect(await count(client, 'users')).toBe(1);
      expect(await count(client, 'memberships')).toBe(0);
      expect(await count(client, 'sessions')).toBe(0);
    });
  });

  it('finds a session only by the hex SHA-256 of its token', async () => {
    await inContext(pool, { lookupTokenHash: sessionHashA.toString('hex') }, async (client) => {
      expect(await count(client, 'sessions')).toBe(1);
      expect(await count(client, 'one_time_tokens')).toBe(0);
    });
    await inContext(pool, { lookupTokenHash: hashBytes().toString('hex') }, async (client) => {
      expect(await count(client, 'sessions')).toBe(0);
    });
  });

  it('finds a one-time token and an invitation by hash', async () => {
    await inContext(pool, { lookupTokenHash: tokenHashB.toString('hex') }, async (client) => {
      expect(await count(client, 'one_time_tokens')).toBe(1);
      expect(await count(client, 'invitations')).toBe(0);
    });
    await inContext(pool, { lookupTokenHash: invitationHashB.toString('hex') }, async (client) => {
      expect(await count(client, 'invitations')).toBe(1);
    });
  });

  it('lets a lookup hash consume a token it can see, and no other', async () => {
    const fresh = hashBytes();
    await inContext(pool, { userId: a.userId }, (client) =>
      client.query(
        `INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at)
         VALUES ($1, 'password_reset', $2, now() + interval '30 minutes')`,
        [a.userId, fresh],
      ),
    );
    await inContext(pool, { lookupTokenHash: fresh.toString('hex') }, async (client) => {
      const sql = 'UPDATE one_time_tokens SET consumed_at = now() WHERE token_hash = $1';
      const own = await client.query(sql, [fresh]);
      const other = await client.query(sql, [tokenHashA]);
      expect([own.rowCount, other.rowCount]).toEqual([1, 0]);
    });
  });

  it('does not match a truncated or malformed hash', async () => {
    const full = createHash('sha256').update('x').digest('hex');
    for (const value of [full.slice(0, 10), '']) {
      await inContext(pool, { lookupTokenHash: value }, async (client) => {
        for (const table of ['sessions', 'one_time_tokens', 'invitations']) {
          expect(await count(client, table), `${table} ${value}`).toBe(0);
        }
      });
    }
  });
});

describe('users visible through the active organization', () => {
  it('shows a co-member to members of the organization and nobody else', async () => {
    const shared = await createSharedOrganization(pool, a.userId);
    const member = await addMember(pool, shared.organizationId, 'viewer', 'colleague');
    await inContext(
      pool,
      { userId: a.userId, organizationId: shared.organizationId },
      async (client) => {
        expect(await count(client, 'users', `id = '${member.userId}'`)).toBe(1);
      },
    );
    await inContext(
      pool,
      { userId: b.userId, organizationId: b.organizationId },
      async (client) => {
        expect(await count(client, 'users', `id = '${member.userId}'`)).toBe(0);
      },
    );
    await inContext(pool, { userId: b.userId }, async (client) => {
      expect(await count(client, 'users', `id = '${member.userId}'`)).toBe(0);
    });
  });
});

describe('DELETE and TRUNCATE', () => {
  it.each(TABLES)('are rejected on %s', async (table) => {
    await expectSqlError(
      inContext(pool, { userId: a.userId, organizationId: a.organizationId }, (client) =>
        client.query(`DELETE FROM ${table}`),
      ),
      INSUFFICIENT_PRIVILEGE,
    );
    await expectSqlError(pool.query(`TRUNCATE ${table} CASCADE`), INSUFFICIENT_PRIVILEGE);
  });
});

describe('soft delete', () => {
  const softDelete = (client: pg.PoolClient, table: string, id: string) =>
    client.query(`UPDATE ${table} SET deleted_at = now() WHERE id = $1`, [id]);

  it('sets deleted_at on a membership of the same organization', async () => {
    const shared = await createSharedOrganization(pool, a.userId);
    const member = await addMember(pool, shared.organizationId, 'editor');
    const context = { userId: a.userId, organizationId: shared.organizationId };
    const result = await inContext(pool, context, (c) =>
      softDelete(c, 'memberships', member.membershipId),
    );
    expect(result.rowCount).toBe(1);
  });

  it('sets deleted_at on a shared organization and on the acting user', async () => {
    const shared = await createSharedOrganization(pool, a.userId);
    const org = await inContext(
      pool,
      { userId: a.userId, organizationId: shared.organizationId },
      (c) => softDelete(c, 'organizations', shared.organizationId),
    );
    const self = await createTenant(pool, 'rls-self');
    const user = await inContext(pool, { userId: self.userId }, (c) =>
      softDelete(c, 'users', self.userId),
    );
    expect([org.rowCount, user.rowCount]).toEqual([1, 1]);
  });

  it('keeps soft-deleted rows of B invisible and unwritable from the context of A', async () => {
    const sharedB = await createSharedOrganization(pool, b.userId);
    const memberB = await addMember(pool, sharedB.organizationId, 'viewer');
    await inContext(
      pool,
      { userId: b.userId, organizationId: sharedB.organizationId },
      async (c) => {
        await softDelete(c, 'memberships', memberB.membershipId);
        await softDelete(c, 'organizations', sharedB.organizationId);
      },
    );
    await inContext(pool, { userId: a.userId, organizationId: a.organizationId }, async (c) => {
      expect(await count(c, 'memberships', `id = '${memberB.membershipId}'`)).toBe(0);
      expect(await count(c, 'organizations', `id = '${sharedB.organizationId}'`)).toBe(0);
      const undelete = await c.query('UPDATE memberships SET deleted_at = NULL WHERE id = $1', [
        memberB.membershipId,
      ]);
      expect(undelete.rowCount).toBe(0);
    });
    // Claiming B's organization without being a member of it still shows nothing of B's users.
    await inContext(
      pool,
      { userId: a.userId, organizationId: sharedB.organizationId },
      async (c) => {
        expect(await count(c, 'organizations', `id = '${sharedB.organizationId}'`)).toBe(0);
      },
    );
  });
});

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
  unique,
  type Tenant,
} from './helpers.js';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const INVALID_ENUM = '22P02';
const FOREIGN_KEY_VIOLATION = '23503';

let pool: pg.Pool;
let tenant: Tenant;

function insertUser(client: pg.PoolClient, email: string, name = 'Ana') {
  return client.query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)', [
    email,
    name,
    '$argon2id$test',
  ]);
}

beforeAll(async () => {
  pool = runtimePool();
  tenant = await createTenant(pool, 'constraints');
});

afterAll(async () => {
  await pool.end();
});

describe('users', () => {
  it('rejects a second active user with the same email', async () => {
    await expectSqlError(
      inContext(pool, {}, (c) => insertUser(c, tenant.email)),
      UNIQUE_VIOLATION,
    );
  });

  it('allows the email again after the account was soft-deleted', async () => {
    const t = await createTenant(pool, 'reuse');
    await inContext(pool, { userId: t.userId }, (c) =>
      c.query('UPDATE users SET deleted_at = now() WHERE id = $1', [t.userId]),
    );
    await inContext(pool, {}, (c) => insertUser(c, t.email));
  });

  it.each([
    ['upper case', 'Upper@Example.test'],
    ['surrounding spaces', ' padded@example.test '],
    ['2 characters', 'a@'],
  ])('rejects an email that is not normalized or too short: %s', async (_case, email) => {
    await expectSqlError(
      inContext(pool, {}, (c) => insertUser(c, email)),
      CHECK_VIOLATION,
    );
  });

  it('rejects an email longer than 254 characters', async () => {
    const email = `${'a'.repeat(250)}@example.test`;
    await expectSqlError(
      inContext(pool, {}, (c) => insertUser(c, email)),
      CHECK_VIOLATION,
    );
  });

  it.each(['', 'n'.repeat(101)])('rejects a name of %j length', async (name) => {
    await expectSqlError(
      inContext(pool, {}, (c) => insertUser(c, `${unique('name')}@example.test`, name)),
      CHECK_VIOLATION,
    );
  });

  it('keeps updated_at current through a trigger', async () => {
    const t = await createTenant(pool, 'touch');
    await inContext(pool, { userId: t.userId }, async (c) => {
      await c.query("UPDATE users SET updated_at = now() - interval '1 day' WHERE id = $1", [
        t.userId,
      ]);
      const stale = await c.query<{ fresh: boolean }>(
        "SELECT updated_at > now() - interval '1 minute' AS fresh FROM users WHERE id = $1",
        [t.userId],
      );
      // The trigger overrides the explicit value on every UPDATE.
      expect(stale.rows[0]!.fresh).toBe(true);
    });
  });
});

describe('organizations', () => {
  it('allows one personal organization per user', async () => {
    await expectSqlError(
      inContext(pool, { userId: tenant.userId }, (c) =>
        c.query(
          "INSERT INTO organizations (name, is_personal, created_by) VALUES ('Otra', true, $1)",
          [tenant.userId],
        ),
      ),
      UNIQUE_VIOLATION,
    );
  });

  it('allows any number of non-personal organizations', async () => {
    await createSharedOrganization(pool, tenant.userId);
    await createSharedOrganization(pool, tenant.userId);
  });

  it('cannot soft-delete a personal organization', async () => {
    await expectSqlError(
      inContext(pool, { userId: tenant.userId, organizationId: tenant.organizationId }, (c) =>
        c.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [
          tenant.organizationId,
        ]),
      ),
      CHECK_VIOLATION,
    );
  });

  it.each(['', 'n'.repeat(101)])('rejects a name of %j length', async (name) => {
    await expectSqlError(
      inContext(pool, { userId: tenant.userId }, (c) =>
        c.query('INSERT INTO organizations (name, created_by) VALUES ($1, $2)', [
          name,
          tenant.userId,
        ]),
      ),
      CHECK_VIOLATION,
    );
  });

  it('defaults is_personal to false', async () => {
    const { organizationId } = await createSharedOrganization(pool, tenant.userId);
    await inContext(pool, { userId: tenant.userId }, async (c) => {
      const { rows } = await c.query<{ is_personal: boolean }>(
        'SELECT is_personal FROM organizations WHERE id = $1',
        [organizationId],
      );
      expect(rows[0]!.is_personal).toBe(false);
    });
  });
});

describe('memberships', () => {
  it('allows a user only one active membership per organization', async () => {
    await expectSqlError(
      inContext(pool, { userId: tenant.userId, organizationId: tenant.organizationId }, (c) =>
        c.query(
          "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'viewer')",
          [tenant.organizationId, tenant.userId],
        ),
      ),
      UNIQUE_VIOLATION,
    );
  });

  it('allows a new membership after the previous one was soft-deleted', async () => {
    const shared = await createSharedOrganization(pool, tenant.userId);
    const member = await addMember(pool, shared.organizationId, 'editor');
    await inContext(pool, { organizationId: shared.organizationId }, async (c) => {
      await c.query('UPDATE memberships SET deleted_at = now() WHERE id = $1', [
        member.membershipId,
      ]);
      await c.query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'viewer')",
        [shared.organizationId, member.userId],
      );
    });
  });

  it('rejects a role outside owner, editor and viewer', async () => {
    await expectSqlError(
      inContext(pool, { organizationId: tenant.organizationId }, (c) =>
        c.query(
          "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
          [tenant.organizationId, tenant.userId],
        ),
      ),
      INVALID_ENUM,
    );
  });

  describe('trigger memberships_keep_owner', () => {
    it('rejects demoting the only owner', async () => {
      const shared = await createSharedOrganization(pool, tenant.userId);
      await expectSqlError(
        inContext(pool, { organizationId: shared.organizationId }, (c) =>
          c.query("UPDATE memberships SET role = 'editor' WHERE id = $1", [shared.membershipId]),
        ),
        CHECK_VIOLATION,
      );
    });

    it('rejects removing the only owner', async () => {
      const shared = await createSharedOrganization(pool, tenant.userId);
      await addMember(pool, shared.organizationId, 'editor');
      await expectSqlError(
        inContext(pool, { organizationId: shared.organizationId }, (c) =>
          c.query('UPDATE memberships SET deleted_at = now() WHERE id = $1', [shared.membershipId]),
        ),
        CHECK_VIOLATION,
      );
    });

    it('allows demoting or removing an owner while another owner remains', async () => {
      const shared = await createSharedOrganization(pool, tenant.userId);
      const second = await addMember(pool, shared.organizationId, 'owner');
      await inContext(pool, { organizationId: shared.organizationId }, async (c) => {
        await c.query("UPDATE memberships SET role = 'editor' WHERE id = $1", [
          second.membershipId,
        ]);
      });
      const third = await addMember(pool, shared.organizationId, 'owner');
      await inContext(pool, { organizationId: shared.organizationId }, async (c) => {
        await c.query('UPDATE memberships SET deleted_at = now() WHERE id = $1', [
          third.membershipId,
        ]);
      });
    });

    it('rejects demoting every owner in one statement', async () => {
      const shared = await createSharedOrganization(pool, tenant.userId);
      await addMember(pool, shared.organizationId, 'owner');
      await expectSqlError(
        inContext(pool, { organizationId: shared.organizationId }, (c) =>
          c.query("UPDATE memberships SET role = 'viewer' WHERE organization_id = $1", [
            shared.organizationId,
          ]),
        ),
        CHECK_VIOLATION,
      );
    });

    it('never leaves an organization without an owner when two owners are demoted at once', async () => {
      const shared = await createSharedOrganization(pool, tenant.userId);
      const second = await addMember(pool, shared.organizationId, 'owner');
      const demote = (membershipId: string) =>
        inContext(pool, { organizationId: shared.organizationId }, (c) =>
          c.query("UPDATE memberships SET role = 'viewer' WHERE id = $1", [membershipId]),
        );
      const results = await Promise.allSettled([
        demote(shared.membershipId),
        demote(second.membershipId),
      ]);
      const owners = await inContext(pool, { organizationId: shared.organizationId }, async (c) => {
        const { rows } = await c.query<{ n: string }>(
          "SELECT count(*) AS n FROM memberships WHERE organization_id = $1 AND role = 'owner'",
          [shared.organizationId],
        );
        return Number(rows[0]!.n);
      });
      expect(owners).toBeGreaterThanOrEqual(1);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    });
  });
});

describe('sessions', () => {
  const insertSession = (c: pg.PoolClient, overrides: Record<string, unknown> = {}) => {
    const row = {
      user_id: tenant.userId,
      token_hash: hashBytes(),
      csrf_token_hash: hashBytes(),
      ip: '203.0.113.7',
      user_agent: 'vitest',
      revoked_at: null,
      revoke_reason: null,
      ...overrides,
    };
    return c.query(
      `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, ip, user_agent, expires_at,
                             revoked_at, revoke_reason)
       VALUES ($1, $2, $3, $4, $5, now() + interval '12 hours', $6, $7)`,
      [
        row.user_id,
        row.token_hash,
        row.csrf_token_hash,
        row.ip,
        row.user_agent,
        row.revoked_at,
        row.revoke_reason,
      ],
    );
  };
  const asTenant = { userId: '' };

  beforeAll(() => {
    asTenant.userId = tenant.userId;
  });

  it('accepts a valid session', async () => {
    await inContext(pool, asTenant, (c) => insertSession(c));
  });

  it('rejects a token hash that is not 32 bytes', async () => {
    await expectSqlError(
      inContext(pool, asTenant, (c) => insertSession(c, { token_hash: Buffer.alloc(31) })),
      CHECK_VIOLATION,
    );
    await expectSqlError(
      inContext(pool, asTenant, (c) => insertSession(c, { csrf_token_hash: Buffer.alloc(33) })),
      CHECK_VIOLATION,
    );
  });

  it('rejects a duplicate token hash', async () => {
    const hash = hashBytes();
    await inContext(pool, asTenant, (c) => insertSession(c, { token_hash: hash }));
    await expectSqlError(
      inContext(pool, asTenant, (c) => insertSession(c, { token_hash: hash })),
      UNIQUE_VIOLATION,
    );
  });

  it('requires revoked_at and revoke_reason together', async () => {
    await expectSqlError(
      inContext(pool, asTenant, (c) => insertSession(c, { revoked_at: new Date() })),
      CHECK_VIOLATION,
    );
    await expectSqlError(
      inContext(pool, asTenant, (c) => insertSession(c, { revoke_reason: 'logout' })),
      CHECK_VIOLATION,
    );
    await inContext(pool, asTenant, (c) =>
      insertSession(c, { revoked_at: new Date(), revoke_reason: 'idle_timeout' }),
    );
  });

  it('rejects an unknown revoke reason and a user agent over 512 characters', async () => {
    await expectSqlError(
      inContext(pool, asTenant, (c) =>
        insertSession(c, { revoked_at: new Date(), revoke_reason: 'because' }),
      ),
      INVALID_ENUM,
    );
    await expectSqlError(
      inContext(pool, asTenant, (c) => insertSession(c, { user_agent: 'u'.repeat(513) })),
      CHECK_VIOLATION,
    );
  });
});

describe('one_time_tokens', () => {
  const insertToken = (c: pg.PoolClient, hash: Buffer, purpose = 'email_verification') =>
    c.query(
      `INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [tenant.userId, purpose, hash],
    );

  it('rejects a hash that is not 32 bytes and a duplicate hash', async () => {
    await expectSqlError(
      inContext(pool, { userId: tenant.userId }, (c) => insertToken(c, Buffer.alloc(16))),
      CHECK_VIOLATION,
    );
    const hash = hashBytes();
    await inContext(pool, { userId: tenant.userId }, (c) => insertToken(c, hash));
    await expectSqlError(
      inContext(pool, { userId: tenant.userId }, (c) => insertToken(c, hash)),
      UNIQUE_VIOLATION,
    );
  });

  it('rejects an unknown purpose', async () => {
    await expectSqlError(
      inContext(pool, { userId: tenant.userId }, (c) => insertToken(c, hashBytes(), 'login')),
      INVALID_ENUM,
    );
  });
});

describe('invitations', () => {
  const insertInvitation = (
    c: pg.PoolClient,
    organizationId: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const row = {
      email: `${unique('inv')}@example.test`,
      role: 'viewer',
      token_hash: hashBytes(),
      status: 'pending',
      accepted_by: null,
      accepted_at: null,
      revoked_at: null,
      ...overrides,
    };
    return c.query(
      `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, status,
                                expires_at, accepted_by, accepted_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days', $7, $8, $9)`,
      [
        organizationId,
        row.email,
        row.role,
        row.token_hash,
        tenant.userId,
        row.status,
        row.accepted_by,
        row.accepted_at,
        row.revoked_at,
      ],
    );
  };

  const withInvitation = async (overrides: Record<string, unknown> = {}) => {
    const shared = await createSharedOrganization(pool, tenant.userId);
    return inContext(pool, { organizationId: shared.organizationId }, (c) =>
      insertInvitation(c, shared.organizationId, overrides),
    );
  };

  it('allows only one pending invitation per organization and email', async () => {
    const shared = await createSharedOrganization(pool, tenant.userId);
    const email = `${unique('dup')}@example.test`;
    const run = () =>
      inContext(pool, { organizationId: shared.organizationId }, (c) =>
        insertInvitation(c, shared.organizationId, { email }),
      );
    await run();
    await expectSqlError(run(), UNIQUE_VIOLATION);
  });

  it('allows a new invitation once the previous one is revoked', async () => {
    const shared = await createSharedOrganization(pool, tenant.userId);
    const email = `${unique('again')}@example.test`;
    await inContext(pool, { organizationId: shared.organizationId }, async (c) => {
      await insertInvitation(c, shared.organizationId, {
        email,
        status: 'revoked',
        revoked_at: new Date(),
      });
      await insertInvitation(c, shared.organizationId, { email });
    });
  });

  it('requires accepted_by and accepted_at when accepted', async () => {
    await expectSqlError(withInvitation({ status: 'accepted' }), CHECK_VIOLATION);
    await expectSqlError(
      withInvitation({ status: 'accepted', accepted_by: tenant.userId }),
      CHECK_VIOLATION,
    );
    await withInvitation({
      status: 'accepted',
      accepted_by: tenant.userId,
      accepted_at: new Date(),
    });
  });

  it('requires revoked_at when revoked', async () => {
    await expectSqlError(withInvitation({ status: 'revoked' }), CHECK_VIOLATION);
    await withInvitation({ status: 'revoked', revoked_at: new Date() });
  });

  it('rejects an unknown status or role, a bad hash and an unnormalized email', async () => {
    await expectSqlError(withInvitation({ status: 'expired' }), INVALID_ENUM);
    await expectSqlError(withInvitation({ role: 'root' }), INVALID_ENUM);
    await expectSqlError(withInvitation({ token_hash: Buffer.alloc(8) }), CHECK_VIOLATION);
    await expectSqlError(withInvitation({ email: 'Mixed@Example.test' }), CHECK_VIOLATION);
  });
});

describe('foreign keys', () => {
  it('rejects rows that point to a missing parent', async () => {
    const ghost = '0198f000-0000-7000-8000-000000000000';
    await expectSqlError(
      inContext(pool, { userId: ghost }, (c) =>
        c.query(
          `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, ip, expires_at)
           VALUES ($1, $2, $3, '203.0.113.7', now())`,
          [ghost, hashBytes(), hashBytes()],
        ),
      ),
      FOREIGN_KEY_VIOLATION,
    );
  });
});

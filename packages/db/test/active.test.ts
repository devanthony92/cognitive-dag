import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  active,
  createDatabase,
  memberships,
  organizations,
  users,
  type DatabaseClient,
} from '../src/index.js';
import {
  addMember,
  createSharedOrganization,
  createTenant,
  expectSqlError,
  inContext,
  requireEnv,
  runtimePool,
} from './helpers.js';

let client: DatabaseClient;

beforeAll(() => {
  client = createDatabase({ connectionString: requireEnv('DATABASE_URL'), max: 4 });
});

afterAll(async () => {
  await client.end();
});

describe('withContext', () => {
  it('sets the context for the transaction and nothing leaks to the next one', async () => {
    const t = await createTenant(client.pool, 'ctx');
    const during = await client.withContext({ userId: t.userId }, (tx) =>
      active.users(tx, eq(users.id, t.userId)),
    );
    const after = await client.withContext({}, (tx) => tx.select().from(users));
    expect(during).toHaveLength(1);
    expect(after).toHaveLength(0);
  });

  it('extends the context mid-transaction', async () => {
    const t = await createTenant(client.pool, 'extend');
    const rows = await client.withContext({ lookupEmail: t.email }, async (tx, extend) => {
      const [found] = await active.users(tx);
      await extend({ userId: found!.id });
      return active.memberships(tx);
    });
    expect(rows).toHaveLength(1);
  });

  it('rolls back when the callback throws', async () => {
    const t = await createTenant(client.pool, 'rollback');
    await expect(
      client.withContext({ userId: t.userId }, async (tx) => {
        await tx.update(users).set({ name: 'Cambiado' }).where(eq(users.id, t.userId));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [row] = await client.withContext({ userId: t.userId }, (tx) => active.users(tx));
    expect(row?.name).toBe(t.userId ? 'rollback' : '');
  });

  it('cannot delete through drizzle either', async () => {
    const t = await createTenant(client.pool, 'nodelete');
    await expect(
      client.withContext({ userId: t.userId }, (tx) => tx.delete(users)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});

describe('active helpers', () => {
  it('never return soft-deleted rows', async () => {
    const owner = await createTenant(client.pool, 'active');
    const shared = await createSharedOrganization(client.pool, owner.userId);
    const member = await addMember(client.pool, shared.organizationId, 'editor');
    const context = { userId: owner.userId, organizationId: shared.organizationId };
    await client.withContext(context, async (tx) => {
      await tx
        .update(memberships)
        .set({ deletedAt: new Date() })
        .where(eq(memberships.id, member.membershipId));
      await tx
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, shared.organizationId));
    });
    await client.withContext(context, async (tx) => {
      const raw = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, member.membershipId));
      expect(raw).toHaveLength(1); // RLS alone does not hide soft-deleted rows (option A)
      expect(await active.memberships(tx, eq(memberships.id, member.membershipId))).toHaveLength(0);
      expect(
        await active.organizations(tx, eq(organizations.id, shared.organizationId)),
      ).toHaveLength(0);
    });
  });

  it('lets the owner invariant count only active owners', async () => {
    const owner = await createTenant(client.pool, 'owners');
    const shared = await createSharedOrganization(client.pool, owner.userId);
    const second = await addMember(client.pool, shared.organizationId, 'owner');
    const pool = runtimePool();
    try {
      await inContext(pool, { organizationId: shared.organizationId }, (c) =>
        c.query('UPDATE memberships SET deleted_at = now() WHERE id = $1', [second.membershipId]),
      );
      // The remaining owner is the only active one: removing it must fail, soft-deleted ones do not count.
      await expectSqlError(
        inContext(pool, { organizationId: shared.organizationId }, (c) =>
          c.query("UPDATE memberships SET role = 'editor' WHERE id = $1", [shared.membershipId]),
        ),
        '23514',
      );
    } finally {
      await pool.end();
    }
  });
});

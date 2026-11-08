import type pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  credentialMetadata,
  credentials,
  createWithContext,
  findCredentialMetadata,
  listCredentialMetadata,
} from '../src/index.js';
import type { Database } from '../src/index.js';
import { CREDENTIAL_INSERT, credentialColumns, ctx } from './f7-fixtures.js';
import { createTenant, inContext, runtimePool, type Tenant } from './helpers.js';

const BYTEA_COLUMNS = [
  'dekWrapped',
  'dekIv',
  'dekTag',
  'secretCt',
  'secretIv',
  'secretTag',
] as const;

let pool: pg.Pool;
let tenant: Tenant;
let withContext: ReturnType<typeof createWithContext>;

beforeAll(async () => {
  pool = runtimePool();
  tenant = await createTenant(pool, 'cred-projection');
  withContext = createWithContext(drizzle(pool) as unknown as Database);
  await inContext(pool, ctx(tenant), async (client) => {
    await client.query(CREDENTIAL_INSERT, credentialColumns(tenant, { name: 'proyeccion' }));
  });
});

afterAll(async () => {
  await pool.end();
});

describe('credential metadata projection', () => {
  it('has no bytea column', () => {
    const shape = Object.keys(credentialMetadata);
    for (const column of BYTEA_COLUMNS) expect(shape).not.toContain(column);
    // Every column of the table that is not bytea is in the projection.
    const table = Object.keys(credentials).filter((key) => !BYTEA_COLUMNS.includes(key as never));
    for (const key of Object.keys(credentialMetadata)) expect(table).toContain(key);
  });

  it('returns rows without the encrypted columns', async () => {
    const rows = await withContext(ctx(tenant), (tx) =>
      listCredentialMetadata(tx, tenant.organizationId),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    for (const column of BYTEA_COLUMNS) expect(row).not.toHaveProperty(column);
    expect(row.name).toBe('proyeccion');
    const found = await withContext(ctx(tenant), (tx) =>
      findCredentialMetadata(tx, tenant.organizationId, row.id),
    );
    expect(found).toHaveLength(1);
    for (const column of BYTEA_COLUMNS) expect(found[0]).not.toHaveProperty(column);
  });
});

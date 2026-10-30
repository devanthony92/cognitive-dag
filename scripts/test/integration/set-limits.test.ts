import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@cognitive-dag/logger';
import { applyLimits, logChange, UsageError, type LimitsChange } from '../../ops/set-limits.ts';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (docker compose up and cp .env.example .env)`);
  return value;
};

let migrator: pg.Pool;
let runtime: pg.Pool;
let organizationId: string;
let userId: string;

/** As registration does: a user and an organization, through app_runtime. */
async function createOrganization(): Promise<{ organizationId: string; userId: string }> {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ user_id: string; organization_id: string }>(
      'SELECT uuidv7() AS user_id, uuidv7() AS organization_id',
    );
    const ids = rows[0]!;
    await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      'app.user_id',
      ids.user_id,
      'app.organization_id',
      ids.organization_id,
    ]);
    await client.query(
      'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
      [ids.user_id, `ops-${ids.user_id}@example.test`, 'Ops', '$argon2id$test'],
    );
    await client.query(
      'INSERT INTO organizations (id, name, is_personal, created_by) VALUES ($1, $2, true, $3)',
      [ids.organization_id, 'Ops', ids.user_id],
    );
    await client.query('COMMIT');
    return { organizationId: ids.organization_id, userId: ids.user_id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** The limits as the API sees them: app_runtime, with the organization in its context. */
async function readAsRuntime(id: string, owner: string) {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      'app.user_id',
      owner,
      'app.organization_id',
      id,
    ]);
    const { rows } = await client.query<{
      max_nodes: number;
      max_edges: number;
      max_definition_bytes: number;
      updated_by: string;
    }>('SELECT max_nodes, max_edges, max_definition_bytes, updated_by FROM organization_limits');
    await client.query('COMMIT');
    return rows;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  migrator = new pg.Pool({ connectionString: required('DATABASE_MIGRATOR_URL'), max: 2 });
  runtime = new pg.Pool({ connectionString: required('DATABASE_URL'), max: 2 });
  ({ organizationId, userId } = await createOrganization());
});

afterAll(async () => {
  await migrator.end();
  await runtime.end();
});

describe('applyLimits (requires docker compose up and pnpm db:migrate)', () => {
  it('creates the limits of an organization that had none, from the platform defaults', async () => {
    const change = await applyLimits(migrator, {
      organizationId,
      operator: 'ana',
      changes: { maxNodes: 3 },
    });
    expect(change).toEqual({
      organizationId,
      operator: 'ana',
      old: null,
      new: { maxNodes: 3, maxEdges: 100, maxDefinitionBytes: 262_144 },
    });
    expect(await readAsRuntime(organizationId, userId)).toEqual([
      { max_nodes: 3, max_edges: 100, max_definition_bytes: 262_144, updated_by: 'ana' },
    ]);
  });

  it('changes only the values given and reports the old and the new ones', async () => {
    const change = await applyLimits(migrator, {
      organizationId,
      operator: 'beto',
      changes: { maxEdges: 7 },
    });
    expect(change.old).toEqual({ maxNodes: 3, maxEdges: 100, maxDefinitionBytes: 262_144 });
    expect(change.new).toEqual({ maxNodes: 3, maxEdges: 7, maxDefinitionBytes: 262_144 });
    expect((await readAsRuntime(organizationId, userId))[0]).toMatchObject({
      max_edges: 7,
      updated_by: 'beto',
    });
  });

  it('leaves row-level security forced, after a change and after a failure', async () => {
    const forced = async () =>
      (
        await migrator.query<{ relforcerowsecurity: boolean }>(
          `SELECT relforcerowsecurity FROM pg_class WHERE relname = 'organization_limits'`,
        )
      ).rows[0]!.relforcerowsecurity;
    expect(await forced()).toBe(true);
    await expect(
      applyLimits(migrator, {
        organizationId: '00000000-0000-7000-8000-000000000000',
        operator: 'ana',
        changes: { maxNodes: 3 },
      }),
    ).rejects.toThrow(UsageError);
    expect(await forced()).toBe(true);
  });

  it('refuses an organization that does not exist', async () => {
    await expect(
      applyLimits(migrator, {
        organizationId: '00000000-0000-7000-8000-000000000001',
        operator: 'ana',
        changes: { maxNodes: 3 },
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('app_runtime still cannot write the table', async () => {
    const client = await runtime.connect();
    try {
      await expect(
        client.query('UPDATE organization_limits SET max_nodes = 500'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(
          `INSERT INTO organization_limits
             (organization_id, max_nodes, max_edges, max_definition_bytes, updated_by)
           VALUES ($1, 5, 5, 2048, 'x')`,
          [organizationId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
    }
  });
});

describe('logChange', () => {
  it('records who, which organization and the old and new values', () => {
    let output = '';
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const change: LimitsChange = {
      organizationId,
      operator: 'ana',
      old: { maxNodes: 50, maxEdges: 100, maxDefinitionBytes: 262_144 },
      new: { maxNodes: 3, maxEdges: 100, maxDefinitionBytes: 262_144 },
    };
    logChange(createLogger({ component: 'ops', level: 'info' }, sink), change);
    const line = JSON.parse(output) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'info',
      component: 'ops',
      event: 'ops.limits_changed',
      operator: 'ana',
      organizationId,
      old: change.old,
      new: change.new,
    });
    expect(typeof line['time']).toBe('string');
  });
});

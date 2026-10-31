import { randomUUID } from 'node:crypto';
import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import Valkey from 'iovalkey';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { createLogger } from '@cognitive-dag/logger';
import type { MockServiceResult } from '../../src/activities/mock-service';

type MockFn = (value: MockServiceInput) => Promise<MockServiceResult>;
import {
  createMockServiceActivities,
  type MockServiceInput,
} from '../../src/activities/mock-service';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import {
  createEffectStore,
  createMockDestination,
  idempotencyKeyFor,
  runIdempotentEffect,
  type EffectDestination,
  type EffectStore,
} from '../../src/resilience/effects';
import { seedRun, type SeededRun } from './support/seed';

loadLocalEnv();
const config = parseEnv(process.env);
const logger = createLogger({ component: 'worker-test', level: 'silent' });

interface EffectRow {
  status: string;
  attempts: number;
  idempotency_key: string;
  committed_at: Date | null;
}

describe('idempotent effects (requires docker compose up)', () => {
  let database: DatabaseClient;
  let pool: pg.Pool;
  let valkey: Valkey;
  let store: EffectStore;
  let destination: EffectDestination;

  beforeAll(() => {
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    valkey = new Valkey(config.VALKEY_URL);
    store = createEffectStore(database.withContext);
    destination = createMockDestination(valkey);
  });

  afterAll(async () => {
    valkey.disconnect();
    await pool.end();
    await database.end();
  });

  const seed = () => seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });
  const refOf = (run: SeededRun, nodeId = 'svc_a') => ({
    organizationId: run.organizationId,
    runId: run.runId,
    nodeId,
  });

  async function effectsOf(run: SeededRun): Promise<EffectRow[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', [
        'app.organization_id',
        run.organizationId,
      ]);
      const { rows } = await client.query<EffectRow>(
        `SELECT status, attempts, idempotency_key, committed_at
           FROM node_effects WHERE run_id = $1 ORDER BY node_id`,
        [run.runId],
      );
      await client.query('COMMIT');
      return rows;
    } finally {
      client.release();
    }
  }

  it('builds the key as runId:nodeId', () => {
    expect(idempotencyKeyFor('r1', 'svc_a')).toBe('r1:svc_a');
  });

  describe('store', () => {
    it('registers the start with the key of the run and the node', async () => {
      const run = await seed();
      const state = await store.begin(refOf(run));
      expect(state).toEqual({ status: 'started', attempts: 1 });
      expect(await effectsOf(run)).toMatchObject([
        { status: 'started', attempts: 1, idempotency_key: `${run.runId}:svc_a` },
      ]);
    });

    it('keeps one row across attempts and counts them', async () => {
      const run = await seed();
      await store.begin(refOf(run));
      const second = await store.begin(refOf(run));
      expect(second).toEqual({ status: 'started', attempts: 2 });
      const rows = await effectsOf(run);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ attempts: 2, status: 'started' });
    });

    it('commits, and a committed effect is reported as such without counting a new attempt', async () => {
      const run = await seed();
      await store.begin(refOf(run));
      await store.commit(refOf(run));
      const again = await store.begin(refOf(run));
      expect(again).toEqual({ status: 'committed', attempts: 1 });
      const [row] = await effectsOf(run);
      expect(row).toMatchObject({ status: 'committed', attempts: 1 });
      expect(row?.committed_at).not.toBeNull();
    });

    it('commits more than once without harm', async () => {
      const run = await seed();
      await store.begin(refOf(run));
      await store.commit(refOf(run));
      await store.commit(refOf(run));
      expect(await effectsOf(run)).toMatchObject([{ status: 'committed' }]);
    });
  });

  describe('protocol (research R4)', () => {
    it('runs the effect once with the key and commits it', async () => {
      const run = await seed();
      const keys: string[] = [];
      const outcome = await runIdempotentEffect({
        store,
        ref: refOf(run),
        execute: (key) => {
          keys.push(key);
          return Promise.resolve('done');
        },
      });
      expect(outcome).toEqual({ replayed: false, value: 'done', attempts: 1 });
      expect(keys).toEqual([`${run.runId}:svc_a`]);
      expect(await effectsOf(run)).toMatchObject([{ status: 'committed' }]);
    });

    it('does not repeat an effect that was committed', async () => {
      const run = await seed();
      let executions = 0;
      const execute = () => {
        executions += 1;
        return Promise.resolve('done');
      };
      await runIdempotentEffect({ store, ref: refOf(run), execute });
      const outcome = await runIdempotentEffect({ store, ref: refOf(run), execute });
      expect(outcome.replayed).toBe(true);
      expect(executions).toBe(1);
    });

    it('retries an effect that was started and not committed, with the same key', async () => {
      const run = await seed();
      const keys: string[] = [];
      await expect(
        runIdempotentEffect({
          store,
          ref: refOf(run),
          execute: (key) => {
            keys.push(key);
            return Promise.reject(new Error('worker died'));
          },
        }),
      ).rejects.toThrow('worker died');
      expect(await effectsOf(run)).toMatchObject([{ status: 'started', attempts: 1 }]);

      const outcome = await runIdempotentEffect({
        store,
        ref: refOf(run),
        execute: (key) => {
          keys.push(key);
          return Promise.resolve('done');
        },
      });
      expect(outcome).toMatchObject({ replayed: false, attempts: 2 });
      expect(new Set(keys)).toEqual(new Set([`${run.runId}:svc_a`]));
      expect(keys).toHaveLength(2);
      expect(await effectsOf(run)).toMatchObject([{ status: 'committed', attempts: 2 }]);
    });

    it('keeps the effects of two nodes of one run apart', async () => {
      const run = await seed();
      await runIdempotentEffect({
        store,
        ref: refOf(run, 'svc_a'),
        execute: () => Promise.resolve(1),
      });
      await runIdempotentEffect({
        store,
        ref: refOf(run, 'svc_b'),
        execute: () => Promise.resolve(2),
      });
      expect((await effectsOf(run)).map((r) => r.idempotency_key)).toEqual([
        `${run.runId}:svc_a`,
        `${run.runId}:svc_b`,
      ]);
    });
  });

  describe('simulated destination', () => {
    it('applies a key once and ignores its repetitions', async () => {
      const key = `${randomUUID()}:svc_a`;
      expect(await destination.register(key)).toBe(true);
      expect(await destination.register(key)).toBe(false);
      expect(await destination.register(key)).toBe(false);
    });

    it('keeps the record under mock:effect:<key> for 7 days', async () => {
      const key = `${randomUUID()}:svc_a`;
      await destination.register(key);
      const ttl = await valkey.ttl(`mock:effect:${key}`);
      expect(ttl).toBeGreaterThan(6 * 24 * 3600);
      expect(ttl).toBeLessThanOrEqual(7 * 24 * 3600);
    });
  });

  describe('in the mock service activity', () => {
    const input = (run: SeededRun): MockServiceInput => ({
      runId: run.runId,
      nodeId: 'svc_a',
      correlationId: randomUUID(),
      organizationId: run.organizationId,
      policy: { maxAttempts: 3, timeoutSeconds: 30, initialIntervalMs: 100 },
      config: { latencyMs: 0, failureRate: 0, failureKind: 'transient' },
    });

    /** Counts the keys the destination applied for the first time. */
    function countingDestination() {
      const applied: string[] = [];
      const wrapped: EffectDestination = {
        register: async (key) => {
          const created = await destination.register(key);
          if (created) applied.push(key);
          return created;
        },
      };
      return { applied, destination: wrapped };
    }

    it('applies the effect once and records it as committed', async () => {
      const run = await seed();
      const { applied, destination: counted } = countingDestination();
      const activities = createMockServiceActivities({
        logger,
        effects: store,
        destination: counted,
      });
      const result = await new MockActivityEnvironment({ attempt: 1 }).run<
        [MockServiceInput],
        MockServiceResult,
        MockFn
      >((v) => activities.mockService(v), input(run));
      expect(result.output).toEqual({ ok: true });
      expect(applied).toEqual([`${run.runId}:svc_a`]);
      expect(await effectsOf(run)).toMatchObject([{ status: 'committed', attempts: 1 }]);
    });

    it('survives a crash after the destination confirmed and before the commit', async () => {
      const run = await seed();
      const { applied, destination: counted } = countingDestination();
      let crash = true;
      const crashing: EffectStore = {
        begin: (ref) => store.begin(ref),
        commit: (ref) => {
          if (crash) {
            crash = false;
            return Promise.reject(new Error('worker killed before the commit'));
          }
          return store.commit(ref);
        },
      };
      const activities = createMockServiceActivities({
        logger,
        effects: crashing,
        destination: counted,
      });

      const first = new MockActivityEnvironment({ attempt: 1 });
      let details: unknown;
      first.on('heartbeat', (d: unknown) => {
        details = d;
      });
      const failure = await first
        .run((v: MockServiceInput) => activities.mockService(v), input(run))
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApplicationFailure);
      expect(await effectsOf(run)).toMatchObject([{ status: 'started' }]);

      const second = new MockActivityEnvironment({
        attempt: 2,
        heartbeatDetails: details,
      });
      const result = await second.run<[MockServiceInput], MockServiceResult, MockFn>(
        (v) => activities.mockService(v),
        input(run),
      );
      expect(result.output).toEqual({ ok: true });
      // The destination saw the key twice and applied it once.
      expect(applied).toEqual([`${run.runId}:svc_a`]);
      expect(await effectsOf(run)).toMatchObject([{ status: 'committed', attempts: 2 }]);
    });

    it('does not touch the destination again once the effect is committed', async () => {
      const run = await seed();
      const { applied, destination: counted } = countingDestination();
      const activities = createMockServiceActivities({
        logger,
        effects: store,
        destination: counted,
      });
      await new MockActivityEnvironment({ attempt: 1 }).run<
        [MockServiceInput],
        MockServiceResult,
        MockFn
      >((v) => activities.mockService(v), input(run));
      const again = await new MockActivityEnvironment({ attempt: 1 }).run<
        [MockServiceInput],
        MockServiceResult,
        MockFn
      >((v) => activities.mockService(v), input(run));
      expect(again.output).toEqual({ ok: true });
      expect(applied).toHaveLength(1);
    });

    it('treats an unavailable effect store as a transient failure', async () => {
      const run = await seed();
      const broken: EffectStore = {
        begin: () => Promise.reject(new Error('postgres down')),
        commit: () => Promise.reject(new Error('postgres down')),
      };
      const activities = createMockServiceActivities({
        logger,
        effects: broken,
        destination,
      });
      const failure = await new MockActivityEnvironment({ attempt: 1 })
        .run((v: MockServiceInput) => activities.mockService(v), input(run))
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        nonRetryable: false,
        details: [expect.objectContaining({ errorClass: 'transient' })],
      });
    });
  });
});

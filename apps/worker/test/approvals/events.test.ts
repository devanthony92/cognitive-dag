import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunEvent } from '@cognitive-dag/contracts';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import {
  createRunEventActivities,
  type RunEventActivities,
} from '../../src/activities/record-run-event';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { seedRun, type SeededRun } from '../integration/support/seed';
import { captureLogger, type CapturedLogger } from '../support/logs';

loadLocalEnv();
const config = parseEnv(process.env);
const EMPTY = { schemaVersion: 1, nodes: [], edges: [] };
const ref = { nodeId: 'ask', nodeType: 'human.approval' };

describe('approval.timed_out security event (requires docker compose up)', () => {
  let database: DatabaseClient;
  let pool: pg.Pool;
  let captured: CapturedLogger;
  let activities: RunEventActivities;

  beforeAll(() => {
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    captured = captureLogger();
    activities = createRunEventActivities({
      withContext: database.withContext,
      publish: () => Promise.resolve(),
      logger: captured.logger,
    });
  });

  afterAll(async () => {
    await pool.end();
    await database.end();
  });

  const base = (run: SeededRun) => ({
    organizationId: run.organizationId,
    runId: run.runId,
    correlationId: randomUUID(),
    at: new Date().toISOString(),
  });

  const requested = (run: SeededRun): RunEvent => ({
    ...base(run),
    transition: 'approval.requested',
    ...ref,
    nodeLabel: 'Aprobar pedido CANARY-LABEL',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  const resolved = (
    run: SeededRun,
    outcome: 'approved' | 'rejected' | 'timed_out' | 'cancelled',
    correlationId = randomUUID(),
  ): RunEvent => ({
    ...base(run),
    correlationId,
    transition: 'approval.resolved',
    ...ref,
    outcome,
    hasComment: false,
  });

  const forRun = (run: SeededRun) =>
    captured.events('approval.timed_out').filter((line) => line.runId === run.runId);

  it('emits the event when a request expires, with organization, run, node and correlation', async () => {
    const run = await seedRun(pool, EMPTY);
    const correlationId = randomUUID();
    await activities.recordRunEvent(requested(run));
    await activities.recordRunEvent(resolved(run, 'timed_out', correlationId));
    const events = forRun(run);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'approval.timed_out',
      organizationId: run.organizationId,
      runId: run.runId,
      nodeId: 'ask',
      correlationId,
    });
  });

  it('carries no content: neither the label of the node nor any message', async () => {
    const run = await seedRun(pool, EMPTY);
    await activities.recordRunEvent(requested(run));
    await activities.recordRunEvent(resolved(run, 'timed_out'));
    const [event] = forRun(run);
    expect(Object.keys(event ?? {}).sort()).toEqual(
      [
        'component',
        'correlationId',
        'event',
        'level',
        'msg',
        'nodeId',
        'organizationId',
        'runId',
        'time',
        'transition',
      ].sort(),
    );
    expect(JSON.stringify(event)).not.toContain('CANARY-LABEL');
  });

  it('does not emit it again for a repeated or late event', async () => {
    const run = await seedRun(pool, EMPTY);
    await activities.recordRunEvent(requested(run));
    await activities.recordRunEvent(resolved(run, 'timed_out'));
    await activities.recordRunEvent(resolved(run, 'timed_out'));
    expect(forRun(run)).toHaveLength(1);
  });

  it('does not emit it when the request was decided before, nor for other outcomes', async () => {
    const decided = await seedRun(pool, EMPTY);
    await activities.recordRunEvent(requested(decided));
    await activities.recordRunEvent(resolved(decided, 'cancelled'));
    await activities.recordRunEvent(resolved(decided, 'timed_out'));
    expect(forRun(decided)).toHaveLength(0);
  });
});

import { randomUUID } from 'node:crypto';
import Valkey from 'iovalkey';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import {
  RunLiveEventSchema,
  runChannel,
  type RunEvent,
  type RunLiveEvent,
} from '@cognitive-dag/contracts';
import { createLogger } from '@cognitive-dag/logger';
import {
  createRunEventActivities,
  type RunEventActivities,
} from '../../src/activities/record-run-event';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { readRun, seedRun, type SeededRun } from './support/seed';

loadLocalEnv();
const config = parseEnv(process.env);

const NODES = [
  { nodeId: 'trigger', nodeType: 'trigger.manual' },
  { nodeId: 'a', nodeType: 'mock.service' },
  { nodeId: 'b', nodeType: 'mock.service' },
];

describe('recordRunEvent (requires docker compose up)', () => {
  let database: DatabaseClient;
  let pool: pg.Pool;
  let publisher: Valkey;
  let subscriber: Valkey;
  let activities: RunEventActivities;
  let failingPublish = false;
  const received: RunLiveEvent[] = [];

  beforeAll(() => {
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    publisher = new Valkey(config.VALKEY_URL);
    subscriber = new Valkey(config.VALKEY_URL);
    subscriber.on('message', (_channel, message) => {
      received.push(RunLiveEventSchema.parse(JSON.parse(message)));
    });
    activities = createRunEventActivities({
      withContext: database.withContext,
      publish: (channel, message) =>
        failingPublish
          ? Promise.reject(new Error('valkey down'))
          : publisher.publish(channel, message),
      logger: createLogger({ component: 'worker-test', level: 'silent' }),
    });
  });

  afterAll(async () => {
    publisher.disconnect();
    subscriber.disconnect();
    await pool.end();
    await database.end();
  });

  const eventBase = (run: SeededRun, at = new Date().toISOString()) => ({
    organizationId: run.organizationId,
    runId: run.runId,
    correlationId: randomUUID(),
    at,
  });

  async function seed(): Promise<SeededRun> {
    return seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });
  }

  it('moves a run from queued to running to succeeded with its steps', async () => {
    const run = await seed();
    await subscriber.subscribe(runChannel(run.runId));

    await activities.recordRunEvent({ ...eventBase(run), transition: 'run.started', nodes: NODES });
    let state = await readRun(pool, run);
    expect(state.run?.status).toBe('running');
    expect(state.run?.started_at).not.toBeNull();
    expect(state.steps.map((s) => [s.node_id, s.status])).toEqual([
      ['a', 'pending'],
      ['b', 'pending'],
      ['trigger', 'pending'],
    ]);

    const a = { nodeId: 'a', nodeType: 'mock.service' };
    await activities.recordRunEvent({ ...eventBase(run), transition: 'step.running', ...a });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'step.succeeded',
      ...a,
      attempts: 2,
      durationMs: 123,
    });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'step.failed',
      nodeId: 'b',
      nodeType: 'mock.service',
      attempts: 3,
      durationMs: 9,
      errorCode: 'MOCK_SERVICE_PERMANENT',
      errorMessage: 'The simulated service failed (permanent).',
    });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'step.skipped',
      nodeId: 'trigger',
      nodeType: 'trigger.manual',
    });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'run.finished',
      status: 'failed',
      errorCode: 'MOCK_SERVICE_PERMANENT',
      errorMessage: 'The simulated service failed (permanent).',
    });

    state = await readRun(pool, run);
    expect(state.run).toMatchObject({
      status: 'failed',
      error_code: 'MOCK_SERVICE_PERMANENT',
    });
    expect(state.run?.finished_at).not.toBeNull();
    const byNode = Object.fromEntries(state.steps.map((s) => [s.node_id, s]));
    expect(byNode['a']).toMatchObject({ status: 'succeeded', attempts: 2, duration_ms: 123 });
    expect(byNode['a']?.started_at).not.toBeNull();
    expect(byNode['a']?.finished_at).not.toBeNull();
    expect(byNode['b']).toMatchObject({
      status: 'failed',
      attempts: 3,
      error_code: 'MOCK_SERVICE_PERMANENT',
    });
    expect(byNode['trigger']).toMatchObject({ status: 'skipped', started_at: null });

    // The live view got every transition, in order, without any data content.
    await expect.poll(() => received.filter((e) => e.runId === run.runId).length).toBe(6);
    const mine = received.filter((e) => e.runId === run.runId);
    expect(mine.map((e) => e.transition)).toEqual([
      'run.started',
      'step.running',
      'step.succeeded',
      'step.failed',
      'step.skipped',
      'run.finished',
    ]);
    expect(mine[0]).toMatchObject({ runStatus: 'running' });
    expect(mine[2]).toMatchObject({ nodeId: 'a', stepStatus: 'succeeded', attempts: 2 });
    expect(mine.at(-1)).toMatchObject({ runStatus: 'failed', errorCode: 'MOCK_SERVICE_PERMANENT' });
  });

  it('is idempotent: repeated events change nothing and never move a step back', async () => {
    const run = await seed();
    const started: RunEvent = { ...eventBase(run), transition: 'run.started', nodes: NODES };
    const running: RunEvent = {
      ...eventBase(run),
      transition: 'step.running',
      nodeId: 'a',
      nodeType: 'mock.service',
    };
    const done: RunEvent = {
      ...eventBase(run),
      transition: 'step.succeeded',
      nodeId: 'a',
      nodeType: 'mock.service',
      attempts: 1,
      durationMs: 5,
    };
    const finished: RunEvent = {
      ...eventBase(run),
      transition: 'run.finished',
      status: 'succeeded',
    };

    for (const event of [started, running, done, finished]) await activities.recordRunEvent(event);
    const first = await readRun(pool, run);

    // Temporal retries or replays the activity: the same events again, even out of order.
    for (const event of [started, running, done, running, finished, done, started]) {
      await activities.recordRunEvent(event);
    }
    const second = await readRun(pool, run);

    expect(second.steps).toHaveLength(3);
    expect(second.steps.find((s) => s.node_id === 'a')).toMatchObject({
      status: 'succeeded',
      attempts: 1,
    });
    expect(second.run?.status).toBe('succeeded');
    expect(second).toEqual(first);
  });

  it('records the error class of a failed step and of the run that failed', async () => {
    const run = await seed();
    await activities.recordRunEvent({ ...eventBase(run), transition: 'run.started', nodes: NODES });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'step.failed',
      nodeId: 'b',
      nodeType: 'mock.service',
      attempts: 3,
      errorCode: 'MOCK_SERVICE_TRANSIENT',
      errorMessage: 'The simulated service failed (transient).',
      errorClass: 'transient',
    });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'run.finished',
      status: 'failed',
      errorCode: 'MOCK_SERVICE_TRANSIENT',
      errorClass: 'transient',
    });
    const state = await readRun(pool, run);
    expect(state.run).toMatchObject({ status: 'failed', error_class: 'transient' });
    expect(state.steps.find((s) => s.node_id === 'b')).toMatchObject({
      status: 'failed',
      error_class: 'transient',
      waiting_reason: null,
    });
  });

  it('sets waiting_reason while a step waits for the rate limit and clears it afterwards', async () => {
    const run = await seed();
    const a = { nodeId: 'a', nodeType: 'mock.service' };
    await activities.recordRunEvent({ ...eventBase(run), transition: 'run.started', nodes: NODES });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'step.running',
      ...a,
      waitingReason: 'rate_limited',
    });
    const stepA = async () => (await readRun(pool, run)).steps.find((s) => s.node_id === 'a');
    expect(await stepA()).toMatchObject({ status: 'running', waiting_reason: 'rate_limited' });

    await activities.recordRunEvent({ ...eventBase(run), transition: 'step.running', ...a });
    expect(await stepA()).toMatchObject({ status: 'running', waiting_reason: null });

    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'step.running',
      ...a,
      waitingReason: 'rate_limited',
    });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'step.succeeded',
      ...a,
      attempts: 1,
    });
    expect(await stepA()).toMatchObject({ status: 'succeeded', waiting_reason: null });
  });

  it('does not let a run leave its final state', async () => {
    const run = await seed();
    await activities.recordRunEvent({ ...eventBase(run), transition: 'run.started', nodes: [] });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'run.finished',
      status: 'cancelled',
    });
    await activities.recordRunEvent({
      ...eventBase(run),
      transition: 'run.finished',
      status: 'succeeded',
    });
    expect((await readRun(pool, run)).run?.status).toBe('cancelled');
  });

  it('writes nothing for another organization (row-level security) and fails without retry', async () => {
    const run = await seed();
    const other = await seed();
    const error = await activities
      .recordRunEvent({
        ...eventBase(run),
        organizationId: other.organizationId,
        transition: 'run.started',
        nodes: NODES,
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ type: 'RUN_NOT_FOUND', nonRetryable: true });
    const state = await readRun(pool, run);
    expect(state.run?.status).toBe('queued');
    expect(state.steps).toHaveLength(0);
  });

  it('rejects a step for a run of another organization through the same-organization trigger', async () => {
    const run = await seed();
    const other = await seed();
    await expect(
      activities.recordRunEvent({
        ...eventBase(run),
        organizationId: other.organizationId,
        transition: 'step.running',
        nodeId: 'a',
        nodeType: 'mock.service',
      }),
    ).rejects.toThrow();
    expect((await readRun(pool, run)).steps).toHaveLength(0);
  });

  it('rejects an event that does not match the contract', async () => {
    const run = await seed();
    await expect(
      activities.recordRunEvent({
        ...eventBase(run),
        transition: 'step.running',
        nodeId: 'Not Valid',
        nodeType: 'mock.service',
      }),
    ).rejects.toThrow();
  });

  it('still records when Valkey is down: the live event is best effort', async () => {
    const run = await seed();
    failingPublish = true;
    try {
      await activities.recordRunEvent({
        ...eventBase(run),
        transition: 'run.started',
        nodes: NODES,
      });
    } finally {
      failingPublish = false;
    }
    expect((await readRun(pool, run)).run?.status).toBe('running');
  });
});

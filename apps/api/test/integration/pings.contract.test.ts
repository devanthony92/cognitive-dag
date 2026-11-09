import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CORRELATION_ID_HEADER,
  PingExecutionSchema,
  ProblemDetailsSchema,
} from '@cognitive-dag/contracts';
import { setupOrgPing, type OrgPingEnv } from './org-ping-helpers';
import { startPingWorker, uniqueTaskQueue, waitFor, type RunningWorker } from './ping-helpers';

describe('ping API contract (requires docker compose up)', () => {
  const taskQueue = uniqueTaskQueue();
  let env: OrgPingEnv;
  let worker: RunningWorker;

  beforeAll(async () => {
    env = await setupOrgPing({ TEMPORAL_TASK_QUEUE: taskQueue });
    worker = await startPingWorker(taskQueue, { workerId: 'contract-worker' });
  });

  afterAll(async () => {
    await worker.stop();
    await env.close();
  });

  it('creates a ping, answers 202 with Location and completes it', async () => {
    const correlationId = randomUUID();
    const created = await env
      .post()
      .set(CORRELATION_ID_HEADER, correlationId)
      .send({ message: 'hola' })
      .expect(202);

    const ping = PingExecutionSchema.parse(created.body);
    expect(ping.pingId).toMatch(/^ping-[0-9a-f-]{36}$/);
    expect(ping.correlationId).toBe(correlationId);
    expect(created.headers['location']).toBe(`${env.base}/${ping.pingId}`);
    expect(created.headers[CORRELATION_ID_HEADER.toLowerCase()]).toBe(correlationId);

    const completed = await waitFor(async () => {
      const response = await env.get(ping.pingId).expect(200);
      const current = PingExecutionSchema.parse(response.body);
      return current.status === 'completed' ? current : undefined;
    });
    expect(completed.result).toEqual({ pong: 'hola', workerId: 'contract-worker', attempts: 1 });
    expect(completed.finishedAt).toBeDefined();
    expect(completed.correlationId).toBe(correlationId);
  });

  it('accepts a request without body', async () => {
    const created = await env.post().expect(202);
    expect(PingExecutionSchema.parse(created.body).pingId).toMatch(/^ping-/);
  });

  it('rejects an invalid body with 422 and field errors', async () => {
    const response = await env.post().send({ message: '', extra: 1 }).expect(422);
    const problem = ProblemDetailsSchema.parse(response.body);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors?.length).toBeGreaterThan(0);
  });

  it('rejects an invalid Idempotency-Key with 422', async () => {
    const response = await env.post().set('Idempotency-Key', 'not-a-uuid').expect(422);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('answers 404 NOT_FOUND for an unknown ping', async () => {
    const response = await env.get(`ping-${randomUUID()}`).expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('NOT_FOUND');
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('answers 422 for a malformed pingId', async () => {
    await env.get('not-a-ping').expect(422);
  });
});

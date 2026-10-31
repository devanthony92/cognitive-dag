import { randomUUID } from 'node:crypto';
import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@cognitive-dag/logger';
import {
  createMockServiceActivities,
  type MockServiceInput,
} from '../../src/activities/mock-service';

const logger = createLogger({ component: 'worker-test', level: 'silent' });

const input = (config: Partial<MockServiceInput['config']> = {}): MockServiceInput => ({
  runId: randomUUID(),
  nodeId: 'a',
  correlationId: randomUUID(),
  config: { latencyMs: 0, failureRate: 0, failureKind: 'transient', ...config },
});

function run(
  config: Partial<MockServiceInput['config']>,
  options: { random?: () => number; timeoutHangMs?: number } = {},
) {
  const env = new MockActivityEnvironment({ attempt: 2 });
  const activities = createMockServiceActivities({ logger, ...options });
  return { env, promise: env.run((value) => activities.mockService(value), input(config)) };
}

describe('mock service activity', () => {
  it('answers ok and reports the attempt it ran in', async () => {
    await expect(run({}).promise).resolves.toEqual({ output: { ok: true }, attempts: 2 });
  });

  it('waits for the configured latency', async () => {
    const started = Date.now();
    await run({ latencyMs: 150 }).promise;
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('never fails with a failure rate of 0, and always fails with a rate of 1', async () => {
    await expect(run({ failureRate: 0 }, { random: () => 0 }).promise).resolves.toBeDefined();
    await expect(run({ failureRate: 1 }, { random: () => 0.999 }).promise).rejects.toBeInstanceOf(
      ApplicationFailure,
    );
  });

  it('fails only when the random draw is below the rate', async () => {
    await expect(run({ failureRate: 0.5 }, { random: () => 0.6 }).promise).resolves.toBeDefined();
    await expect(run({ failureRate: 0.5 }, { random: () => 0.4 }).promise).rejects.toBeDefined();
  });

  it('fails a transient error as retryable, with the attempt as detail', async () => {
    const error = (await run({ failureRate: 1, failureKind: 'transient' }).promise.catch(
      (e: unknown) => e,
    )) as ApplicationFailure;
    expect(error).toMatchObject({
      type: 'MOCK_SERVICE_TRANSIENT',
      nonRetryable: false,
      details: [{ attempt: 2 }],
    });
  });

  it('fails a permanent error as non retryable', async () => {
    const error = (await run({ failureRate: 1, failureKind: 'permanent' }).promise.catch(
      (e: unknown) => e,
    )) as ApplicationFailure;
    expect(error).toMatchObject({ type: 'MOCK_SERVICE_PERMANENT', nonRetryable: true });
  });

  it('hangs on a timeout failure until cancelled, so Temporal can time it out', async () => {
    const { env, promise } = run(
      { failureRate: 1, failureKind: 'timeout' },
      { timeoutHangMs: 60_000 },
    );
    setTimeout(() => env.cancel(), 100);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops waiting when the activity is cancelled', async () => {
    const { env, promise } = run({ latencyMs: 30_000 });
    setTimeout(() => env.cancel(), 100);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not put the failure message of the input data in the error', async () => {
    const error = (await run({ failureRate: 1 }).promise.catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('The simulated service failed (transient).');
  });
});

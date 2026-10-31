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

describe('mock service fault injection (F4)', () => {
  const attemptRun = (attempt: number, config: Partial<MockServiceInput['config']>) => {
    const env = new MockActivityEnvironment({ attempt });
    const activities = createMockServiceActivities({ logger });
    return env.run((value) => activities.mockService(value), input(config));
  };

  it('fails a limited error as retryable, asking to wait what was configured', async () => {
    const error = (await attemptRun(1, {
      failureRate: 1,
      failureKind: 'rate_limited',
      retryAfterMs: 3000,
    }).catch((e: unknown) => e)) as ApplicationFailure;
    expect(error).toMatchObject({
      type: 'MOCK_SERVICE_RATE_LIMITED',
      nonRetryable: false,
      nextRetryDelay: 3000,
      details: [{ attempt: 1, errorClass: 'rate_limited' }],
    });
  });

  it('labels transient and permanent failures with their class', async () => {
    const transient = (await attemptRun(1, { failureRate: 1 }).catch(
      (e: unknown) => e,
    )) as ApplicationFailure;
    const permanent = (await attemptRun(1, { failureRate: 1, failureKind: 'permanent' }).catch(
      (e: unknown) => e,
    )) as ApplicationFailure;
    expect(transient.details).toEqual([{ attempt: 1, errorClass: 'transient' }]);
    expect(permanent.details).toEqual([{ attempt: 1, errorClass: 'permanent' }]);
  });

  it('fails the first N attempts and then works, without chance', async () => {
    const config = { failFirstAttempts: 2, failureRate: 0 };
    await expect(attemptRun(1, config)).rejects.toBeInstanceOf(ApplicationFailure);
    await expect(attemptRun(2, config)).rejects.toBeInstanceOf(ApplicationFailure);
    await expect(attemptRun(3, config)).resolves.toMatchObject({ output: { ok: true } });
  });

  it('lets failFirstAttempts win over failureRate', async () => {
    const config = { failFirstAttempts: 1, failureRate: 1 };
    await expect(attemptRun(1, config)).rejects.toBeInstanceOf(ApplicationFailure);
    await expect(attemptRun(2, config)).resolves.toMatchObject({ output: { ok: true } });
  });

  it('fails with the configured kind during the first attempts', async () => {
    const error = (await attemptRun(1, {
      failFirstAttempts: 1,
      failureKind: 'permanent',
    }).catch((e: unknown) => e)) as ApplicationFailure;
    expect(error).toMatchObject({ type: 'MOCK_SERVICE_PERMANENT', nonRetryable: true });
  });
});

describe('mock service heartbeats under a policy', () => {
  it('re-sends the attempt state in every heartbeat, so a long wait never erases the counters', async () => {
    const env = new MockActivityEnvironment({ attempt: 1 });
    const beats: unknown[] = [];
    env.on('heartbeat', (details: unknown) => beats.push(details));
    const activities = createMockServiceActivities({ logger });
    await env.run((value) => activities.mockService(value), {
      ...input({ latencyMs: 4_500 }),
      organizationId: randomUUID(),
      policy: { maxAttempts: 2, timeoutSeconds: 12, initialIntervalMs: 100 },
    });
    // The wait heartbeats every 2 s: at least the start of the attempt and two beats of the wait.
    expect(beats.length).toBeGreaterThanOrEqual(3);
    for (const details of beats) {
      expect(details).toMatchObject({ spent: 0, executed: 1, inFlight: true });
    }
  });
});

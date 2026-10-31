import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import Valkey from 'iovalkey';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@cognitive-dag/logger';
import {
  createMockServiceActivities,
  type MockServiceInput,
  type WaitingMark,
} from '../../src/activities/mock-service';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { createRateLimiter, type RateLimiter } from '../../src/resilience/rate-limiter';

loadLocalEnv();
const config = parseEnv(process.env);
const logger = createLogger({ component: 'worker-test', level: 'silent' });

describe('rate limiter (requires docker compose up)', () => {
  let valkey: Valkey;

  beforeAll(() => {
    valkey = new Valkey(config.VALKEY_URL);
  });

  afterAll(() => {
    valkey.disconnect();
  });

  const limiterFor = (capacity: number, refillPerSecond: number, client: Valkey = valkey) =>
    createRateLimiter({
      valkey: client,
      limits: { 'mock.service': { capacity, refillPerSecond } },
    });

  describe('token bucket', () => {
    it('grants exactly the capacity to concurrent requests (atomic)', async () => {
      const limiter = limiterFor(3, 0.01);
      const org = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 12 }, () => limiter.acquire(org, 'mock.service')),
      );
      expect(results.filter((r) => r.granted)).toHaveLength(3);
    });

    it('tells how long to wait for the next token', async () => {
      const limiter = limiterFor(1, 2); // one token every 500 ms
      const org = randomUUID();
      expect(await limiter.acquire(org, 'mock.service')).toEqual({ granted: true });
      const denied = await limiter.acquire(org, 'mock.service');
      expect(denied.granted).toBe(false);
      const wait = denied.granted ? 0 : denied.retryAfterMs;
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(500);
    });

    it('refills continuously', async () => {
      const limiter = limiterFor(1, 10); // one token every 100 ms
      const org = randomUUID();
      expect((await limiter.acquire(org, 'mock.service')).granted).toBe(true);
      expect((await limiter.acquire(org, 'mock.service')).granted).toBe(false);
      await sleep(250);
      expect((await limiter.acquire(org, 'mock.service')).granted).toBe(true);
    });

    it('never holds more than its capacity', async () => {
      const limiter = limiterFor(2, 100);
      const org = randomUUID();
      await limiter.acquire(org, 'mock.service');
      await sleep(300); // enough to refill 30 tokens
      const results = await Promise.all(
        Array.from({ length: 6 }, () => limiter.acquire(org, 'mock.service')),
      );
      expect(results.filter((r) => r.granted)).toHaveLength(2);
    });

    it('isolates organizations: one cannot spend the capacity of another', async () => {
      const limiter = limiterFor(1, 0.01);
      const [orgA, orgB] = [randomUUID(), randomUUID()];
      expect((await limiter.acquire(orgA, 'mock.service')).granted).toBe(true);
      expect((await limiter.acquire(orgA, 'mock.service')).granted).toBe(false);
      expect((await limiter.acquire(orgB, 'mock.service')).granted).toBe(true);
    });

    it('isolates node types: each has its own bucket', async () => {
      const limiter = createRateLimiter({
        valkey,
        limits: {
          'mock.service': { capacity: 1, refillPerSecond: 0.01 },
          'http.request': { capacity: 1, refillPerSecond: 0.01 },
        },
      });
      const org = randomUUID();
      expect((await limiter.acquire(org, 'mock.service')).granted).toBe(true);
      expect((await limiter.acquire(org, 'http.request')).granted).toBe(true);
      expect((await limiter.acquire(org, 'mock.service')).granted).toBe(false);
    });

    it('does not limit a node type without a configured limit', async () => {
      const limiter = limiterFor(1, 0.01);
      const org = randomUUID();
      for (let i = 0; i < 5; i++) {
        expect(await limiter.acquire(org, 'llm.classify')).toEqual({ granted: true });
      }
    });

    it('keeps its keys as rl:<organizationId>:<nodeType> with an expiry', async () => {
      const limiter = limiterFor(2, 1);
      const org = randomUUID();
      await limiter.acquire(org, 'mock.service');
      const key = `rl:${org}:mock.service`;
      expect(await valkey.hexists(key, 'tokens')).toBe(1);
      expect(await valkey.hexists(key, 'updatedAt')).toBe(1);
      expect(await valkey.ttl(key)).toBeGreaterThan(0);
    });

    it('rejects when the store is unavailable, and never grants without a token', async () => {
      const broken = new Valkey('redis://127.0.0.1:1', {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      broken.on('error', () => undefined);
      const limiter = limiterFor(1, 1, broken);
      await expect(limiter.acquire(randomUUID(), 'mock.service')).rejects.toBeDefined();
      broken.disconnect();
    });
  });

  describe('in the mock service activity', () => {
    const input = (overrides: Partial<MockServiceInput> = {}): MockServiceInput => ({
      runId: randomUUID(),
      nodeId: 'a',
      correlationId: randomUUID(),
      organizationId: randomUUID(),
      policy: { maxAttempts: 1, timeoutSeconds: 30, initialIntervalMs: 100 },
      config: { latencyMs: 0, failureRate: 0, failureKind: 'transient' },
      ...overrides,
    });

    function scripted(denials: number): RateLimiter & { calls: number } {
      const state = { calls: 0 };
      return Object.assign(state, {
        acquire: () => {
          state.calls += 1;
          return Promise.resolve(
            state.calls <= denials
              ? ({ granted: false, retryAfterMs: 250 } as const)
              : ({ granted: true } as const),
          );
        },
      });
    }

    /** Runs one attempt; returns the heartbeat details to carry into the next one. */
    async function attempt(
      rateLimiter: RateLimiter,
      marks: Array<WaitingMark['waitingReason']>,
      value: MockServiceInput,
      previous?: unknown,
    ) {
      const env = new MockActivityEnvironment({
        attempt: 1,
        ...(previous === undefined ? {} : { heartbeatDetails: previous }),
      });
      let details: unknown = previous;
      env.on('heartbeat', (d: unknown) => {
        details = d;
      });
      const activities = createMockServiceActivities({
        logger,
        rateLimiter,
        markWaiting: (mark) => {
          marks.push(mark.waitingReason);
          return Promise.resolve();
        },
      });
      const outcome = await env
        .run((v: MockServiceInput) => activities.mockService(v), value)
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        );
      return { ...outcome, details };
    }

    it('waits with the delay of the next token, without sleeping in the worker', async () => {
      const marks: Array<WaitingMark['waitingReason']> = [];
      const started = Date.now();
      const first = await attempt(scripted(1), marks, input());
      expect(Date.now() - started).toBeLessThan(200);
      const error = (first as { error: ApplicationFailure }).error;
      expect(error).toBeInstanceOf(ApplicationFailure);
      expect(error).toMatchObject({ type: 'NODE_RATE_LIMITED', nonRetryable: false });
      expect(error.nextRetryDelay).toBe(250);
    });

    it('marks the step as waiting and clears the mark when the token arrives', async () => {
      const marks: Array<WaitingMark['waitingReason']> = [];
      const limiter = scripted(2);
      const value = input();
      const first = await attempt(limiter, marks, value);
      expect(marks).toEqual(['rate_limited']);
      const second = await attempt(limiter, marks, value, first.details);
      expect(marks).toEqual(['rate_limited', 'rate_limited']);
      const third = await attempt(limiter, marks, value, second.details);
      expect(marks).toEqual(['rate_limited', 'rate_limited', null]);
      expect((third as { result: { attempts: number } }).result.attempts).toBe(1);
    });

    it('does not spend attempts while waiting: maxAttempts 1 still gets its try', async () => {
      const marks: Array<WaitingMark['waitingReason']> = [];
      const limiter = scripted(4);
      const value = input({
        policy: { maxAttempts: 1, timeoutSeconds: 30, initialIntervalMs: 100 },
      });
      let previous: unknown;
      for (let i = 0; i < 4; i++) {
        const waiting = await attempt(limiter, marks, value, previous);
        expect((waiting as { error: ApplicationFailure }).error).toMatchObject({
          type: 'NODE_RATE_LIMITED',
          nonRetryable: false,
        });
        previous = waiting.details;
      }
      const done = await attempt(limiter, marks, value, previous);
      expect((done as { result: unknown }).result).toBeDefined();
    });

    it('treats an unavailable store as a transient failure and never runs the effect', async () => {
      const broken: RateLimiter = { acquire: () => Promise.reject(new Error('store down')) };
      const marks: Array<WaitingMark['waitingReason']> = [];
      const outcome = await attempt(
        broken,
        marks,
        input({ policy: { maxAttempts: 3, timeoutSeconds: 30, initialIntervalMs: 100 } }),
      );
      expect((outcome as { error: ApplicationFailure }).error).toMatchObject({
        type: 'RATE_LIMIT_UNAVAILABLE',
        nonRetryable: false,
        details: [expect.objectContaining({ errorClass: 'transient' })],
      });
      expect((outcome as { result?: unknown }).result).toBeUndefined();
    });
  });
});

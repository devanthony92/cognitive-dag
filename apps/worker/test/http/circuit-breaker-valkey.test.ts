import { randomUUID } from 'node:crypto';
import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import Valkey from 'iovalkey';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { createLogger } from '@cognitive-dag/logger';
import {
  createHttpActivities,
  type HttpRequestInput,
  type HttpRequestResult,
} from '../../src/http/activities';
import { createValkeyCircuitBreaker, breakerKey } from '../../src/http/circuit-breaker';
import { createCredentialResolver } from '../../src/http/credentials';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { seedRun, type SeededRun } from '../integration/support/seed';
import { MASTER_KEY, startLocalServer, type LocalServer } from '../support/f7';
import { captureLogger } from '../support/logs';

loadLocalEnv();
const config = parseEnv(process.env);
const logger = createLogger({ component: 'worker-test', level: 'silent' });

const SETTINGS = { failureThreshold: 5, windowMs: 60_000, cooldownMs: 700 };
const POLICY = { maxAttempts: 3, timeoutSeconds: 10, initialIntervalMs: 100 };

describe('circuit breaker on Valkey (requires docker compose up)', () => {
  let valkey: Valkey;
  let database: DatabaseClient;
  let pool: pg.Pool;
  let server: LocalServer;
  let status = 200;

  beforeAll(async () => {
    valkey = new Valkey(config.VALKEY_URL);
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    server = await startLocalServer((_request, response) => {
      response.writeHead(status, { 'content-type': 'text/plain' });
      response.end('x');
    });
  });

  afterAll(async () => {
    await server.close();
    valkey.disconnect();
    await pool.end();
    await database.end();
  });

  const fresh = () => ({ org: randomUUID(), host: `svc-${randomUUID().slice(0, 8)}.example.com` });
  const breaker = () => createValkeyCircuitBreaker(valkey, SETTINGS);
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function openIt(org: string, host: string) {
    const cb = breaker();
    for (let i = 0; i < SETTINGS.failureThreshold; i++) await cb.failure(org, host, false);
  }

  describe('state machine', () => {
    it('opens after 5 failures in the window and not before', async () => {
      const { org, host } = fresh();
      const cb = breaker();
      for (let i = 0; i < 4; i++) {
        expect(await cb.failure(org, host, false)).toEqual({ opened: false });
        expect(await cb.acquire(org, host)).toEqual({ allowed: true, probe: false });
      }
      expect(await cb.failure(org, host, false)).toEqual({ opened: true });
      const denied = await cb.acquire(org, host);
      expect(denied.allowed).toBe(false);
      if (!denied.allowed) {
        expect(denied.retryAfterMs).toBeGreaterThan(0);
        expect(denied.retryAfterMs).toBeLessThanOrEqual(SETTINGS.cooldownMs);
      }
    });

    it('the atomic script opens exactly once under concurrent failures', async () => {
      const { org, host } = fresh();
      const cb = breaker();
      const results = await Promise.all(
        Array.from({ length: 30 }, () => cb.failure(org, host, false)),
      );
      expect(results.filter((r) => r.opened)).toHaveLength(1);
    });

    it('lets a single probe through when half open, even with concurrency', async () => {
      const { org, host } = fresh();
      await openIt(org, host);
      await sleep(SETTINGS.cooldownMs + 100);
      const cb = breaker();
      const decisions = await Promise.all(Array.from({ length: 12 }, () => cb.acquire(org, host)));
      expect(decisions.filter((d) => d.allowed)).toHaveLength(1);
      expect(decisions.find((d) => d.allowed)).toEqual({ allowed: true, probe: true });
    });

    it('closes after a successful probe and wipes the failures', async () => {
      const { org, host } = fresh();
      await openIt(org, host);
      await sleep(SETTINGS.cooldownMs + 100);
      const cb = breaker();
      const probe = await cb.acquire(org, host);
      expect(probe).toEqual({ allowed: true, probe: true });
      await cb.success(org, host, true);
      expect(await cb.acquire(org, host)).toEqual({ allowed: true, probe: false });
      // A fresh window: four failures do not open it again.
      for (let i = 0; i < 4; i++) expect((await cb.failure(org, host, false)).opened).toBe(false);
    });

    it('reports that the successful probe closed the circuit, and only that one', async () => {
      const { org, host } = fresh();
      const cb = breaker();
      expect(await cb.success(org, host, false)).toEqual({ closed: false });
      await openIt(org, host);
      await sleep(SETTINGS.cooldownMs + 100);
      expect(await cb.acquire(org, host)).toEqual({ allowed: true, probe: true });
      expect(await cb.success(org, host, true)).toEqual({ closed: true });
      expect(await cb.success(org, host, true)).toEqual({ closed: false });
    });

    it('opens again after a failed probe, for another cooldown', async () => {
      const { org, host } = fresh();
      await openIt(org, host);
      await sleep(SETTINGS.cooldownMs + 100);
      const cb = breaker();
      expect(await cb.acquire(org, host)).toEqual({ allowed: true, probe: true });
      expect(await cb.failure(org, host, true)).toEqual({ opened: true });
      expect((await cb.acquire(org, host)).allowed).toBe(false);
    });

    it('keeps one breaker per organization and host', async () => {
      const a = fresh();
      const b = fresh();
      await openIt(a.org, a.host);
      const cb = breaker();
      expect((await cb.acquire(a.org, a.host)).allowed).toBe(false);
      expect((await cb.acquire(a.org, b.host)).allowed).toBe(true);
      expect((await cb.acquire(b.org, a.host)).allowed).toBe(true);
    });

    it('forgets the failures outside the window', async () => {
      const { org, host } = fresh();
      const short = createValkeyCircuitBreaker(valkey, { ...SETTINGS, windowMs: 300 });
      for (let i = 0; i < 4; i++) await short.failure(org, host, false);
      await sleep(400);
      expect((await short.failure(org, host, false)).opened).toBe(false);
    });

    it('stores its keys under cb:<organization>:<host> and expires them', async () => {
      const { org, host } = fresh();
      await openIt(org, host);
      expect(await valkey.hget(breakerKey(org, host), 'state')).toBe('open');
      expect(await valkey.ttl(breakerKey(org, host))).toBeGreaterThan(0);
    });
  });

  describe('in the http.request activity', () => {
    let run: SeededRun;
    let host: string;

    beforeAll(async () => {
      run = await seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });
      host = '127.0.0.1';
    });

    function activity(
      options: { valkeyClient?: Valkey; maxWaitMs?: number; log?: typeof logger } = {},
    ): (input: HttpRequestInput, scheduledAgoMs?: number) => Promise<HttpRequestResult> {
      const impl = createHttpActivities({
        logger: options.log ?? logger,
        enabled: true,
        credentials: createCredentialResolver({
          withContext: database.withContext,
          masterKey: MASTER_KEY,
        }),
        breaker: createValkeyCircuitBreaker(options.valkeyClient ?? valkey, SETTINGS),
        breakerMaxWaitMs: options.maxWaitMs ?? 120_000,
        allowLoopback: true,
        tls: { ca: server.ca },
      });
      return (input, scheduledAgoMs = 0) =>
        new MockActivityEnvironment({
          attempt: 1,
          scheduledTimestampMs: Date.now() - scheduledAgoMs,
        }).run<
          [HttpRequestInput],
          HttpRequestResult,
          (value: HttpRequestInput) => Promise<HttpRequestResult>
        >((value) => impl.httpRequest(value), input);
    }

    const inputOf = (nodeId = 'call'): HttpRequestInput => ({
      runId: run.runId,
      nodeId,
      correlationId: randomUUID(),
      organizationId: run.organizationId,
      policy: POLICY,
      config: { method: 'GET', url: server.url('/x'), headers: {}, body: '' },
    });

    const failureOf = async (promise: Promise<unknown>): Promise<ApplicationFailure> => {
      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApplicationFailure);
      return error as ApplicationFailure;
    };

    it('does not call the destination while the circuit is open, and waits the cooldown', async () => {
      const call = activity();
      await openIt(run.organizationId, host);
      const before = server.requests.length;
      const error = await failureOf(call(inputOf()));
      expect(server.requests.length).toBe(before);
      expect(error).toMatchObject({ type: 'HTTP_CIRCUIT_OPEN', nonRetryable: false });
      expect(error.details?.[0]).toMatchObject({ errorClass: 'rate_limited' });
      expect(Number(error.nextRetryDelay)).toBeGreaterThan(0);
      expect(Number(error.nextRetryDelay)).toBeLessThanOrEqual(SETTINGS.cooldownMs);
    });

    it('opens by itself after 5 failing calls and closes with one good probe', async () => {
      const org = await seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });
      const call = activity();
      const input = { ...inputOf(), runId: org.runId, organizationId: org.organizationId };
      status = 503;
      for (let i = 0; i < SETTINGS.failureThreshold; i++) {
        await failureOf(call(input));
      }
      const hits = server.requests.length;
      const blocked = await failureOf(call(input));
      expect(blocked.type).toBe('HTTP_CIRCUIT_OPEN');
      expect(server.requests.length).toBe(hits);

      status = 200;
      await sleep(SETTINGS.cooldownMs + 150);
      await expect(call(input)).resolves.toMatchObject({ output: { status: 200 } });
      // Closed again: the next call goes straight through.
      await expect(call(input)).resolves.toMatchObject({ output: { status: 200 } });
    });

    it('emits circuit.closed once, when the probe of the half-open state succeeds, without content', async () => {
      const org = await seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });
      const captured = captureLogger();
      const call = activity({ log: captured.logger });
      const input = {
        ...inputOf(),
        runId: org.runId,
        organizationId: org.organizationId,
        config: { ...inputOf().config, body: 'SECRET-CANARY-0001' },
      };
      status = 503;
      for (let i = 0; i < SETTINGS.failureThreshold; i++) await failureOf(call(input));
      expect(captured.events('circuit.opened')).toHaveLength(1);
      expect(captured.events('circuit.closed')).toHaveLength(0);

      status = 200;
      await sleep(SETTINGS.cooldownMs + 150);
      await call(input);
      await call(input);
      const closed = captured.events('circuit.closed');
      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({
        event: 'circuit.closed',
        host,
        organizationId: org.organizationId,
        runId: org.runId,
        nodeId: input.nodeId,
        correlationId: input.correlationId,
      });
      expect(captured.raw()).not.toContain('SECRET-CANARY-0001');
    });

    it('does not count 429, 4xx or a blocked address as failures', async () => {
      const org = await seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });
      const call = activity();
      const input = { ...inputOf(), runId: org.runId, organizationId: org.organizationId };
      for (const code of [429, 404, 400]) {
        status = code;
        for (let i = 0; i < 6; i++) await failureOf(call(input));
      }
      status = 200;
      await expect(call(input)).resolves.toMatchObject({ output: { status: 200 } });
    });

    it('past the maximum wait it fails HTTP_CIRCUIT_OPEN as transient', async () => {
      const org = await seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });
      await openIt(org.organizationId, host);
      const call = activity({ maxWaitMs: 1000 });
      const input = { ...inputOf(), runId: org.runId, organizationId: org.organizationId };
      const error = await failureOf(call(input, 5000));
      expect(error).toMatchObject({ type: 'HTTP_CIRCUIT_OPEN' });
      expect(error.details?.[0]).toMatchObject({ errorClass: 'transient' });
    });

    it('fails closed when Valkey does not answer: the destination is not called', async () => {
      const dead = new Valkey({
        host: '127.0.0.1',
        port: 1,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      dead.on('error', () => undefined);
      const call = activity({ valkeyClient: dead });
      const before = server.requests.length;
      const error = await failureOf(call(inputOf()));
      expect(error).toMatchObject({ type: 'HTTP_CIRCUIT_UNAVAILABLE', nonRetryable: false });
      expect(server.requests.length).toBe(before);
      dead.disconnect();
    });
  });
});

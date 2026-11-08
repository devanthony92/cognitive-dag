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
  parseRetryAfter,
  type HttpActivities,
  type HttpRequestInput,
  type HttpRequestResult,
} from '../../src/http/activities';
import { createValkeyCircuitBreaker } from '../../src/http/circuit-breaker';
import { createCredentialResolver } from '../../src/http/credentials';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { createEffectStore } from '../../src/resilience/effects';
import { seedRun, type SeededRun } from '../integration/support/seed';
import {
  MASTER_KEY,
  insertAllowedHost,
  insertCredential,
  startLocalServer,
  type LocalServer,
} from '../support/f7';

loadLocalEnv();
const config = parseEnv(process.env);
const logger = createLogger({ component: 'worker-test', level: 'silent' });

const EMPTY = { schemaVersion: 1, nodes: [], edges: [] };
const POLICY = { maxAttempts: 3, timeoutSeconds: 10, initialIntervalMs: 100 };

describe('http.request activity (requires docker compose up)', () => {
  let database: DatabaseClient;
  let pool: pg.Pool;
  let valkey: Valkey;
  let server: LocalServer;
  let respond: (status: number, headers?: Record<string, string>, body?: string) => void;
  let next: { status: number; headers: Record<string, string>; body: string };
  let activities: HttpActivities;
  let enabled = true;

  beforeAll(async () => {
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    valkey = new Valkey(config.VALKEY_URL);
    next = { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' };
    respond = (status, headers = { 'content-type': 'text/plain' }, body = '') => {
      next = { status, headers, body };
    };
    server = await startLocalServer((_request, response) => {
      response.writeHead(next.status, next.headers);
      response.end(next.body);
    });
    activities = build(() => enabled);
  });

  afterAll(async () => {
    await server.close();
    valkey.disconnect();
    await pool.end();
    await database.end();
  });

  function build(isEnabled: () => boolean): HttpActivities {
    return {
      httpRequest: (input) =>
        createHttpActivities({
          logger,
          enabled: isEnabled(),
          credentials: createCredentialResolver({
            withContext: database.withContext,
            masterKey: MASTER_KEY,
          }),
          // A fresh breaker key space per run: the organization of each test is its own.
          breaker: createValkeyCircuitBreaker(valkey, {
            failureThreshold: 50,
            windowMs: 60_000,
            cooldownMs: 1000,
          }),
          breakerMaxWaitMs: 120_000,
          effects: createEffectStore(database.withContext),
          allowLoopback: true,
          tls: { ca: server.ca },
          random: () => 0,
        }).httpRequest(input),
    };
  }

  const seed = (): Promise<SeededRun> => seedRun(pool, EMPTY);

  const inputFor = (
    run: SeededRun,
    config: Partial<HttpRequestInput['config']> = {},
    nodeId = 'call',
  ): HttpRequestInput => ({
    runId: run.runId,
    nodeId,
    correlationId: randomUUID(),
    organizationId: run.organizationId,
    policy: POLICY,
    config: { method: 'GET', url: server.url('/x'), headers: {}, body: '', ...config },
  });

  function call(input: HttpRequestInput, attempt = 1): Promise<HttpRequestResult> {
    return new MockActivityEnvironment({ attempt }).run<
      [HttpRequestInput],
      HttpRequestResult,
      (value: HttpRequestInput) => Promise<HttpRequestResult>
    >((value) => activities.httpRequest(value), input);
  }

  async function failure(input: HttpRequestInput, attempt = 1): Promise<ApplicationFailure> {
    const error = await call(input, attempt).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApplicationFailure);
    return error as ApplicationFailure;
  }

  it('returns the status and the body of a successful call', async () => {
    const run = await seed();
    respond(200, { 'content-type': 'application/json' }, '{"ok":true}');
    const result = await call(inputFor(run));
    expect(result).toEqual({ output: { status: 200, body: '{"ok":true}' }, attempts: 1 });
  });

  it('sends the credential header, and only the one the credential defines', async () => {
    const run = await seed();
    const bearer = await insertCredential(database.withContext, {
      organizationId: run.organizationId,
      userId: run.userId,
      secret: 'super-secret-token',
    });
    const apiKey = await insertCredential(database.withContext, {
      organizationId: run.organizationId,
      userId: run.userId,
      kind: 'api_key_header',
      headerName: 'X-Api-Key',
      secret: 'key-123',
    });
    respond(200);
    const before = server.requests.length;
    await call(inputFor(run, { credentialId: bearer }));
    await call(inputFor(run, { credentialId: apiKey }));
    const [first, second] = server.requests.slice(before);
    expect(first!.headers['authorization']).toBe('Bearer super-secret-token');
    expect(second!.headers['x-api-key']).toBe('key-123');
    expect(second!.headers['authorization']).toBeUndefined();
  });

  it('treats 5xx as transient and retryable, without the URL or the body in the message', async () => {
    const run = await seed();
    respond(503, { 'content-type': 'text/plain' }, 'internal-secret-body');
    const error = await failure(inputFor(run));
    expect(error).toMatchObject({ type: 'HTTP_SERVER_ERROR', nonRetryable: false });
    expect(error.details?.[0]).toMatchObject({ errorClass: 'transient', attempt: 1 });
    const text = JSON.stringify({
      message: error.message,
      type: error.type,
      details: error.details,
    });
    expect(text).not.toContain('internal-secret-body');
    expect(text).not.toContain(String(server.port));
    expect(text).not.toContain('127.0.0.1');
  });

  it('treats a network failure as transient', async () => {
    const run = await seed();
    const closed = await startLocalServer(() => undefined);
    const url = closed.url('/gone');
    await closed.close();
    const error = await failure(inputFor(run, { url }));
    expect(error).toMatchObject({ nonRetryable: false });
    expect(error.details?.[0]).toMatchObject({ errorClass: 'transient' });
    expect(error.message).not.toContain('127.0.0.1');
  });

  it('turns 429 into rate_limited and waits what Retry-After says (seconds and date)', async () => {
    const run = await seed();
    respond(429, { 'retry-after': '2', 'content-type': 'text/plain' });
    const seconds = await failure(inputFor(run));
    expect(seconds).toMatchObject({ type: 'HTTP_RATE_LIMITED', nonRetryable: false });
    expect(seconds.details?.[0]).toMatchObject({ errorClass: 'rate_limited' });
    expect(seconds.nextRetryDelay).toBe(2000);

    respond(429, {
      'retry-after': new Date(Date.now() + 5000).toUTCString(),
      'content-type': 'text/plain',
    });
    const date = await failure(inputFor(run));
    expect(Number(date.nextRetryDelay)).toBeGreaterThan(1000);
    expect(Number(date.nextRetryDelay)).toBeLessThanOrEqual(5000);

    expect(parseRetryAfter('abc')).toBeUndefined();
    expect(parseRetryAfter('0')).toBe(0);
  });

  it.each([400, 401, 403, 404, 408, 422])('treats %i as permanent', async (status) => {
    const run = await seed();
    respond(status);
    const error = await failure(inputFor(run));
    expect(error).toMatchObject({ type: 'HTTP_CLIENT_ERROR', nonRetryable: true });
    expect(error.details?.[0]).toMatchObject({ errorClass: 'permanent' });
  });

  it('sends the same Idempotency-Key on every retry, and only on methods with an effect', async () => {
    const run = await seed();
    const before = server.requests.length;
    respond(503);
    await failure(inputFor(run, { method: 'POST', body: '{"a":1}' }), 1);
    await failure(inputFor(run, { method: 'POST', body: '{"a":1}' }), 2);
    respond(200);
    await call(inputFor(run, { method: 'POST', body: '{"a":1}' }), 3);
    const keys = server.requests.slice(before).map((r) => r.headers['idempotency-key']);
    expect(keys).toEqual([`${run.runId}:call`, `${run.runId}:call`, `${run.runId}:call`]);

    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const mark = server.requests.length;
      await call(inputFor(run, { method }, `n_${method.toLowerCase()}`));
      expect(server.requests[mark]!.headers['idempotency-key']).toBe(
        `${run.runId}:n_${method.toLowerCase()}`,
      );
    }
    const mark = server.requests.length;
    await call(inputFor(run, { method: 'GET' }, 'plain'));
    expect(server.requests[mark]!.headers['idempotency-key']).toBeUndefined();
  });

  it('records the effect of a method with an effect in node_effects, and not a GET', async () => {
    const run = await seed();
    respond(200);
    await call(inputFor(run, { method: 'POST' }, 'post_node'));
    await call(inputFor(run, { method: 'GET' }, 'get_node'));
    // app_runtime reads node_effects only in the context of the organization.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      const visible = await client.query(
        'SELECT node_id, status, attempts FROM node_effects WHERE run_id = $1',
        [run.runId],
      );
      await client.query('COMMIT');
      expect(visible.rows).toEqual([{ node_id: 'post_node', status: 'committed', attempts: 1 }]);
    } finally {
      client.release();
    }
  });

  it('fails HTTP_DISABLED without calling the destination when the kill switch is off', async () => {
    const run = await seed();
    enabled = false;
    try {
      const before = server.requests.length;
      const error = await failure(inputFor(run));
      expect(error).toMatchObject({ type: 'HTTP_DISABLED', nonRetryable: true });
      expect(server.requests.length).toBe(before);
    } finally {
      enabled = true;
    }
  });

  it('fails CREDENTIAL_UNAVAILABLE for an archived or foreign credential, with one message', async () => {
    const run = await seed();
    const other = await seed();
    const archived = await insertCredential(database.withContext, {
      organizationId: run.organizationId,
      userId: run.userId,
      archived: true,
    });
    const foreign = await insertCredential(database.withContext, {
      organizationId: other.organizationId,
      userId: other.userId,
    });
    const before = server.requests.length;
    const messages = new Set<string>();
    for (const credentialId of [archived, foreign, randomUUID()]) {
      const error = await failure(inputFor(run, { credentialId }));
      expect(error).toMatchObject({ type: 'CREDENTIAL_UNAVAILABLE', nonRetryable: true });
      messages.add(error.message);
    }
    expect(messages.size).toBe(1);
    expect(server.requests.length).toBe(before);
  });

  it('applies the allowlist of the organization before connecting', async () => {
    const run = await seed();
    await insertAllowedHost(database.withContext, {
      organizationId: run.organizationId,
      userId: run.userId,
      pattern: 'api.example.com',
    });
    const before = server.requests.length;
    const error = await failure(inputFor(run));
    expect(error).toMatchObject({ type: 'HTTP_HOST_NOT_ALLOWED', nonRetryable: true });
    expect(server.requests.length).toBe(before);
  });

  it('blocks a non public destination (SSRF) even with a fake loopback allowance off', async () => {
    const run = await seed();
    const strict = createHttpActivities({
      logger,
      enabled: true,
      credentials: createCredentialResolver({
        withContext: database.withContext,
        masterKey: MASTER_KEY,
      }),
      breaker: createValkeyCircuitBreaker(valkey, {
        failureThreshold: 5,
        windowMs: 60_000,
        cooldownMs: 1000,
      }),
      breakerMaxWaitMs: 120_000,
    });
    const error = await new MockActivityEnvironment({ attempt: 1 })
      .run((value: HttpRequestInput) => strict.httpRequest(value), inputFor(run))
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ type: 'SSRF_BLOCKED_ADDRESS', nonRetryable: true });
  });
});

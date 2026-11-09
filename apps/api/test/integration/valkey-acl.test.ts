import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import Valkey from 'iovalkey';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runChannel } from '@cognitive-dag/contracts';
import type { DatabaseClient } from '@cognitive-dag/db';
import { createValkeyCircuitBreaker } from '../../../worker/src/http/circuit-breaker';
import { createRateLimiter } from '../../../worker/src/resilience/rate-limiter';
import { valkeyOptions } from '../../src/valkey/valkey-options';
import { httpServer, testConfig } from './helpers';
import {
  createVerifiedUser,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  uniqueEmail,
  type TestUser,
} from './identity-helpers';

/**
 * The exact command set the Valkey ACL of production (`deploy/valkey/`, T035) must allow for the user
 * of the application (FR-010). It is pinned here: a command the code starts to use without being
 * listed fails this test, and a command removed from the list shows which feature breaks.
 *
 * - Session cache and progressive login wait: SET/GET/DEL/EXPIRE/INCR/PTTL.
 * - `rate-limiter-flexible` (fixed limits): its Lua scripts and the commands they call.
 * - Token buckets and circuit breaker (Lua, `EVALSHA` with `EVAL` as fallback): HGET/HMGET/HSET/ZADD/
 *   ZCARD/ZREMRANGEBYSCORE/TIME/PTTL/SET/DEL/EXPIRE inside the scripts.
 * - Live run events: PUBLISH (worker) and SUBSCRIBE/UNSUBSCRIBE (API).
 * - Client handshake and health: AUTH, PING, INFO.
 */
export const VALKEY_ALLOWED_COMMANDS = [
  'auth',
  'del',
  'eval',
  'evalsha',
  'expire',
  'get',
  'hget',
  'hmget',
  'hset',
  'incr',
  'incrby',
  'info',
  'ping',
  'pttl',
  'publish',
  'set',
  'subscribe',
  'time',
  'unsubscribe',
  'zadd',
  'zcard',
  'zremrangebyscore',
] as const;

/** The channels the application publishes and subscribes to. */
export const VALKEY_ALLOWED_CHANNELS = ['run:*'] as const;

// Each entry is a command with valid arguments, so a refusal can only come from the ACL.
const FORBIDDEN: [string, ...string[]][] = [
  ['FLUSHALL'],
  ['FLUSHDB'],
  ['KEYS', '*'],
  ['SCAN', '0'],
  ['CONFIG', 'GET', 'maxmemory'],
  ['ACL', 'WHOAMI'],
  ['MONITOR'],
];

describe('Valkey ACL of the application user (F9, FR-010; requires docker compose up)', () => {
  const username = `acl_test_${randomUUID().slice(0, 8)}`;
  const password = randomBytes(18).toString('hex');
  let admin: Valkey;
  let app: INestApplication;
  let database: DatabaseClient;
  let user: TestUser;
  let restricted: Valkey;

  beforeAll(async () => {
    admin = new Valkey(testConfig().VALKEY_URL);
    await admin.call(
      'ACL',
      'SETUSER',
      username,
      'on',
      `>${password}`,
      '-@all',
      'resetkeys',
      '~*',
      'resetchannels',
      ...VALKEY_ALLOWED_CHANNELS.map((channel) => `&${channel}`),
      ...VALKEY_ALLOWED_COMMANDS.map((command) => `+${command}`),
    );
    // The API runs as the restricted user: the same options the production configuration builds.
    app = await startIdentityApp(undefined, { valkeyAuth: { username, password } });
    database = openDatabase();
    await resetRateLimits();
    user = await createVerifiedUser(app, database, 'acl');
    restricted = new Valkey(testConfig().VALKEY_URL, valkeyOptions({ username, password }));
  });

  afterAll(async () => {
    restricted.disconnect();
    await app.close();
    await database.end();
    await admin.call('ACL', 'DELUSER', username);
    admin.disconnect();
  });

  it('keeps the session cache working: login, authenticated read and logout', async () => {
    const session = await loginAs(app, user);
    await request(httpServer(app))
      .get('/api/v1/auth/session')
      .set('Cookie', session.cookie)
      .expect(200);
  });

  it('keeps the progressive login wait and the fixed limits working', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(httpServer(app))
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('acl'), password: 'contraseña-incorrecta-123' })
        .expect(401);
    }
    await request(httpServer(app))
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('acl'), password: 'contraseña-incorrecta-123' })
      .expect(429);
  });

  it('keeps the Lua scripts working: token bucket and circuit breaker', async () => {
    const organizationId = randomUUID();
    const limiter = createRateLimiter({
      valkey: restricted,
      limits: { 'mock.service': { capacity: 1, refillPerSecond: 0.001 } },
    });
    expect(await limiter.acquire(organizationId, 'mock.service')).toEqual({ granted: true });
    expect(await limiter.acquire(organizationId, 'mock.service')).toMatchObject({ granted: false });

    const breaker = createValkeyCircuitBreaker(restricted, {
      failureThreshold: 2,
      windowMs: 60_000,
      cooldownMs: 60_000,
    });
    const host = `${randomUUID()}.example.test`;
    expect(await breaker.acquire(organizationId, host)).toEqual({ allowed: true, probe: false });
    await breaker.failure(organizationId, host, false);
    expect(await breaker.failure(organizationId, host, false)).toEqual({ opened: true });
    expect(await breaker.acquire(organizationId, host)).toMatchObject({ allowed: false });
  });

  it('keeps live events working: publish and subscribe on the run channels', async () => {
    const subscriber = restricted.duplicate();
    const channel = runChannel(randomUUID());
    const received = new Promise<string>((resolve) => {
      subscriber.on('message', (_channel: string, message: string) => resolve(message));
    });
    await subscriber.subscribe(channel);
    await restricted.publish(channel, 'ping');
    expect(await received).toBe('ping');
    subscriber.disconnect();
  });

  it('refuses a channel outside the allowed ones', async () => {
    const subscriber = restricted.duplicate();
    subscriber.on('error', () => undefined);
    await expect(subscriber.subscribe('other:channel')).rejects.toThrow(/NOPERM/);
    subscriber.disconnect();
  });

  it.each(FORBIDDEN)('refuses %s', async (command, ...args) => {
    await expect(restricted.call(command, ...args)).rejects.toThrow(/NOPERM/);
  });

  it('refuses KEYS and CONFIG with arguments too', async () => {
    await expect(restricted.keys('*')).rejects.toThrow(/NOPERM/);
    await expect(restricted.call('CONFIG', 'GET', 'maxmemory')).rejects.toThrow(/NOPERM/);
    await expect(restricted.flushall()).rejects.toThrow(/NOPERM/);
  });

  describe('with maxmemory full and noeviction', () => {
    let previous: { maxmemory: string; policy: string };

    beforeAll(async () => {
      // The failures of the tests above must not block this one with a 429 before it reaches Valkey.
      await resetRateLimits();
      const get = async (name: string) =>
        String(((await admin.config('GET', name)) as string[])[1]);
      previous = { maxmemory: await get('maxmemory'), policy: await get('maxmemory-policy') };
      const used = Number(/used_memory:(\d+)/.exec(await admin.info('memory'))?.[1]);
      // A limit below what is already in use: memory is full, and with noeviction nothing is dropped
      // to make room, so every command that needs memory is refused.
      await admin.config('SET', 'maxmemory-policy', 'noeviction');
      await admin.config('SET', 'maxmemory', String(used - 64 * 1024));
    });

    afterAll(async () => {
      await admin.config('SET', 'maxmemory', previous.maxmemory);
      await admin.config('SET', 'maxmemory-policy', previous.policy);
    });

    it('fails closed with 503: it neither evicts nor lets the request through unchecked', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('oom'), password: 'contraseña-incorrecta-123' });
      expect(response.status).toBe(503);
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });
});

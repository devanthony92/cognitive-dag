import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemDetailsSchema } from '@cognitive-dag/contracts';
import type { DatabaseClient } from '@cognitive-dag/db';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { httpServer, startTestApp } from './helpers';
import {
  createVerifiedUser,
  IDENTITY_FLAGS,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  uniqueEmail,
  withValkey,
  type TestUser,
} from './identity-helpers';

describe('login rate limiting (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let user: TestUser;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
    await resetRateLimits();
    user = await createVerifiedUser(app, database, 'limit');
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  const attempt = (email: string, password = 'contraseña-incorrecta-123') =>
    request(httpServer(app)).post('/api/v1/auth/login').send({ email, password });

  async function failFiveTimes(email: string): Promise<void> {
    for (let i = 0; i < 5; i += 1) await attempt(email).expect(401);
  }

  it('lets four failures pass and starts the wait with the fifth', async () => {
    for (let i = 0; i < 4; i += 1) await attempt(user.email).expect(401);
    await attempt(user.email).expect(401);

    const blocked = await attempt(user.email).expect(429);
    const problem = ProblemDetailsSchema.parse(blocked.body);
    expect(problem.code).toBe('RATE_LIMITED');
    expect(problem.retryAfterSeconds).toBe(1);
    expect(blocked.headers['retry-after']).toBe('1');
  });

  it('blocks even the right password while the account is waiting', async () => {
    await failFiveTimes(user.email);
    await attempt(user.email, user.password).expect(429);
  });

  it('doubles the wait with each further failure', async () => {
    await failFiveTimes(user.email);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await attempt(user.email).expect(401);

    const blocked = await attempt(user.email).expect(429);
    expect(ProblemDetailsSchema.parse(blocked.body).retryAfterSeconds).toBe(2);
  });

  it('limits per account: a wait on one email survives a reset of the IP counters', async () => {
    await failFiveTimes(user.email);
    await withValkey(async (valkey) => {
      const keys = await valkey.keys('rl:login:ip:*');
      if (keys.length > 0) await valkey.del(...keys);
    });

    await attempt(user.email, user.password).expect(429);
    await attempt(uniqueEmail('other')).expect(401);
  });

  it('limits per IP: failures against many accounts block that IP', async () => {
    for (let i = 0; i < 5; i += 1) await attempt(uniqueEmail('spray')).expect(401);

    await attempt(uniqueEmail('fresh')).expect(429);
    // The IP wait also blocks a valid login from the same address.
    await attempt(user.email, user.password).expect(429);
  });

  it('forgets the account failures after a successful login', async () => {
    for (let i = 0; i < 4; i += 1) await attempt(user.email).expect(401);
    await loginAs(app, user);
    await withValkey(async (valkey) => {
      const keys = await valkey.keys('rl:login:ip:*');
      if (keys.length > 0) await valkey.del(...keys);
    });

    for (let i = 0; i < 4; i += 1) await attempt(user.email).expect(401);
  });

  it('emits auth.rate_limited when it blocks an attempt', async () => {
    const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
    await failFiveTimes(user.email);
    await attempt(user.email).expect(429);

    expect(emit.mock.calls.map(([event]) => event)).toContainEqual(
      expect.objectContaining({ event: 'auth.rate_limited', outcome: 'blocked' }),
    );
    emit.mockRestore();
  });

  describe('when Valkey is down', () => {
    let degraded: INestApplication;

    beforeAll(async () => {
      // Nothing listens on this port: every command fails or times out.
      degraded = await startTestApp({
        FEATURE_FLAGS: IDENTITY_FLAGS,
        VALKEY_URL: 'redis://127.0.0.1:6390',
      });
    });

    afterAll(async () => {
      await degraded.close();
    });

    it('fails closed on login with 503 and sets no cookie', async () => {
      const response = await request(httpServer(degraded))
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(503);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('SERVICE_UNAVAILABLE');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('fails closed on an authenticated request with 503, not 401 and not 200', async () => {
      const session = await loginAs(app, user);
      const response = await request(httpServer(degraded))
        .get('/api/v1/auth/session')
        .set('Cookie', session.cookie)
        .expect(503);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('SERVICE_UNAVAILABLE');
    });
  });
});

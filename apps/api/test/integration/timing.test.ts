import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient } from '@cognitive-dag/db';
import { httpServer } from './helpers';
import {
  createVerifiedUser,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  STRONG_PASSWORD,
  uniqueEmail,
  type TestUser,
} from './identity-helpers';

/** SC-004: the mean response time must not reveal whether an email has an account. */
const MAX_MEAN_DIFFERENCE_MS = 50;
const SAMPLES = 25;

async function timed(call: () => PromiseLike<unknown>): Promise<number> {
  const started = performance.now();
  await call();
  return performance.now() - started;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

describe('anti-enumeration timing (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let user: TestUser;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
    await resetRateLimits();
    user = await createVerifiedUser(app, database, 'timing');
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  /**
   * Alternates both cases so drift (GC, CPU frequency) hits them equally, and resets the counters
   * outside the measured section so rate limiting never changes the code path under test.
   */
  async function compare(
    existing: () => request.Test,
    unknown: () => request.Test,
  ): Promise<{ existing: number; unknown: number }> {
    const withAccount: number[] = [];
    const withoutAccount: number[] = [];
    for (let i = 0; i < SAMPLES + 2; i += 1) {
      await resetRateLimits();
      const a = await timed(() => existing());
      await resetRateLimits();
      const b = await timed(() => unknown());
      // The first two rounds warm up Argon2, the pool and the JIT.
      if (i >= 2) {
        withAccount.push(a);
        withoutAccount.push(b);
      }
    }
    return { existing: mean(withAccount), unknown: mean(withoutAccount) };
  }

  it('login: wrong password for an existing email vs an unknown email', async () => {
    const result = await compare(
      () =>
        request(httpServer(app))
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: 'contraseña-incorrecta-123' }),
      () =>
        request(httpServer(app))
          .post('/api/v1/auth/login')
          .send({ email: uniqueEmail('ghost'), password: 'contraseña-incorrecta-123' }),
    );
    expect(Math.abs(result.existing - result.unknown)).toBeLessThan(MAX_MEAN_DIFFERENCE_MS);
  });

  it('register: an existing email vs a new one', async () => {
    const result = await compare(
      () =>
        request(httpServer(app))
          .post('/api/v1/auth/register')
          .send({ name: 'Repetido', email: user.email, password: STRONG_PASSWORD }),
      () =>
        request(httpServer(app))
          .post('/api/v1/auth/register')
          .send({ name: 'Nuevo', email: uniqueEmail('new'), password: STRONG_PASSWORD }),
    );
    expect(Math.abs(result.existing - result.unknown)).toBeLessThan(MAX_MEAN_DIFFERENCE_MS);
  });

  it('resend verification: an existing unverified email vs an unknown one', async () => {
    const pending = uniqueEmail('pending');
    await request(httpServer(app))
      .post('/api/v1/auth/register')
      .send({ name: 'Pendiente', email: pending, password: STRONG_PASSWORD })
      .expect(202);

    const result = await compare(
      () =>
        request(httpServer(app)).post('/api/v1/auth/verify-email/resend').send({ email: pending }),
      () =>
        request(httpServer(app))
          .post('/api/v1/auth/verify-email/resend')
          .send({ email: uniqueEmail('ghost') }),
    );
    expect(Math.abs(result.existing - result.unknown)).toBeLessThan(MAX_MEAN_DIFFERENCE_MS);
  });

  // Password reset (US4, PR 3) joins this file when its endpoint exists.
});

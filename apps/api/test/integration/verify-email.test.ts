import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema } from '@cognitive-dag/contracts';
import { active, eq, oneTimeTokens, type DatabaseClient } from '@cognitive-dag/db';
import { httpServer } from './helpers';
import {
  emailsTo,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  STRONG_PASSWORD,
  tokenFrom,
  uniqueEmail,
  waitForEmails,
} from './identity-helpers';

describe('email verification (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  const api = () => request(httpServer(app));

  async function registered(label = 'verify') {
    const email = uniqueEmail(label);
    await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Ana', email, password: STRONG_PASSWORD })
      .expect(202);
    const [message] = await waitForEmails(email);
    return { email, token: tokenFrom(message!) };
  }

  const verified = async (email: string) => {
    const [user] = await database.withContext({ lookupEmail: email }, (tx) => active.users(tx));
    return user!.emailVerifiedAt;
  };

  it('verifies the email and consumes the token', async () => {
    const { email, token } = await registered();
    expect(await verified(email)).toBeNull();

    await api().post('/api/v1/auth/verify-email').send({ token }).expect(204);
    expect(await verified(email)).toBeInstanceOf(Date);

    const second = await api().post('/api/v1/auth/verify-email').send({ token }).expect(422);
    expect(ProblemDetailsSchema.parse(second.body).code).toBe('TOKEN_INVALID');
  });

  it('rejects a token that does not exist, with the same answer as a used one', async () => {
    const response = await api()
      .post('/api/v1/auth/verify-email')
      .send({ token: 'A'.repeat(43) })
      .expect(422);
    const problem = ProblemDetailsSchema.parse(response.body);
    expect(problem.code).toBe('TOKEN_INVALID');
    expect(problem.detail).toMatch(/vencido|no es válido/i);
  });

  it('rejects a malformed token as a validation error', async () => {
    const response = await api()
      .post('/api/v1/auth/verify-email')
      .send({ token: 'corto' })
      .expect(422);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an expired token and leaves the email unverified', async () => {
    const { email, token } = await registered('expired');
    const [user] = await database.withContext({ lookupEmail: email }, (tx) => active.users(tx));
    await database.withContext({ userId: user!.id }, (tx) =>
      tx
        .update(oneTimeTokens)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(oneTimeTokens.userId, user!.id)),
    );
    const response = await api().post('/api/v1/auth/verify-email').send({ token }).expect(422);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('TOKEN_INVALID');
    expect(await verified(email)).toBeNull();
  });

  it('accepts a token only once when it is used concurrently', async () => {
    const { token } = await registered('concurrent');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => api().post('/api/v1/auth/verify-email').send({ token })),
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422)).toHaveLength(3);
  });

  it('does not accept a password-reset token for verification', async () => {
    const { email } = await registered('purpose');
    const [user] = await database.withContext({ lookupEmail: email }, (tx) => active.users(tx));
    const stray = randomBytes(32).toString('base64url');
    await database.withContext({ userId: user!.id }, (tx) =>
      tx.insert(oneTimeTokens).values({
        userId: user!.id,
        purpose: 'password_reset',
        tokenHash: createHash('sha256').update(stray).digest(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    await api().post('/api/v1/auth/verify-email').send({ token: stray }).expect(422);
    expect(await verified(email)).toBeNull();
  });

  describe('resend', () => {
    it('sends a new link and invalidates the previous one', async () => {
      const { email, token: first } = await registered('resend');
      await api().post('/api/v1/auth/verify-email/resend').send({ email }).expect(202);
      const messages = await waitForEmails(email, 2);
      const second = tokenFrom(messages[1]!);
      expect(second).not.toBe(first);

      await api().post('/api/v1/auth/verify-email').send({ token: first }).expect(422);
      await api().post('/api/v1/auth/verify-email').send({ token: second }).expect(204);
    });

    it('answers the same for unknown and already verified emails, and sends nothing', async () => {
      const { email, token } = await registered('already');
      await api().post('/api/v1/auth/verify-email').send({ token }).expect(204);
      const unknown = uniqueEmail('ghost');

      const known = await api()
        .post('/api/v1/auth/verify-email/resend')
        .send({ email })
        .expect(202);
      const ghost = await api()
        .post('/api/v1/auth/verify-email/resend')
        .send({ email: unknown })
        .expect(202);
      expect(ghost.body).toEqual(known.body);

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await emailsTo(unknown)).toHaveLength(0);
      expect(await emailsTo(email)).toHaveLength(1);
    });

    it('is rate limited per email', async () => {
      const email = uniqueEmail('spam');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await api().post('/api/v1/auth/verify-email/resend').send({ email }).expect(202);
      }
      const response = await api()
        .post('/api/v1/auth/verify-email/resend')
        .send({ email })
        .expect(429);
      const problem = ProblemDetailsSchema.parse(response.body);
      expect(problem.code).toBe('RATE_LIMITED');
      expect(Number(response.headers['retry-after'])).toBe(problem.retryAfterSeconds);
    });
  });
});

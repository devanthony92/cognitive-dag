import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemDetailsSchema } from '@cognitive-dag/contracts';
import { eq, oneTimeTokens, sql, type DatabaseClient } from '@cognitive-dag/db';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { httpServer } from './helpers';
import {
  createVerifiedUser,
  emailsTo,
  loginAs,
  openDatabase,
  resetRateLimits,
  sessionKey,
  startIdentityApp,
  tokenFrom,
  uniqueEmail,
  waitForEmails,
  withValkey,
  type TestUser,
} from './identity-helpers';

const NEW_PASSWORD = 'otra-contraseña-nueva';

describe('password reset (requires docker compose up and pnpm db:migrate)', () => {
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
  const requestReset = (email: string) =>
    api().post('/api/v1/auth/password-reset/request').send({ email });
  const confirm = (body: Record<string, unknown>) =>
    api().post('/api/v1/auth/password-reset/confirm').send(body);

  /** Reset links only: registration also mailed a verification link to the same address. */
  async function resetEmails(address: string, count = 1) {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const found = (await emailsTo(address)).filter((mail) => /Restablece/.test(mail.subject));
      if (found.length >= count) return found;
      if (Date.now() > deadline) throw new Error(`No ${count} reset email(s) for ${address}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async function userWithResetToken(label = 'reset'): Promise<{ user: TestUser; token: string }> {
    const user = await createVerifiedUser(app, database, label);
    await requestReset(user.email).expect(202);
    const [email] = await resetEmails(user.email);
    return { user, token: tokenFrom(email!) };
  }

  const tokenRow = (token: string) =>
    database.withContext(
      { lookupTokenHash: createHash('sha256').update(token, 'utf8').digest('hex') },
      async (tx) => (await tx.select().from(oneTimeTokens))[0],
    );

  describe('request', () => {
    it('answers identically for an existing and an unknown email, and mails only the former', async () => {
      const user = await createVerifiedUser(app, database, 'reset-same');
      const ghost = uniqueEmail('ghost');

      const existing = await requestReset(user.email).expect(202);
      const unknown = await requestReset(ghost).expect(202);

      expect(unknown.body).toEqual(existing.body);
      expect(unknown.status).toBe(existing.status);
      const mails = await resetEmails(user.email);
      expect(mails[0]!.subject).toMatch(/contraseña/i);
      expect(mails[0]!.headers['X-Correlation-Id']).toBeDefined();
      expect(await emailsTo(ghost)).toHaveLength(0);
    });

    it('stores only the SHA-256 of a token that lives 30 minutes', async () => {
      const { token } = await userWithResetToken('reset-ttl');
      const row = await tokenRow(token);
      expect(row?.purpose).toBe('password_reset');
      expect(row?.tokenHash.toString('hex')).toBe(
        createHash('sha256').update(token, 'utf8').digest('hex'),
      );
      const lifetimeMs = row!.expiresAt.getTime() - row!.createdAt.getTime();
      expect(lifetimeMs).toBeGreaterThan(29 * 60_000);
      expect(lifetimeMs).toBeLessThanOrEqual(30 * 60_000 + 1_000);
    });

    it('only the newest link works', async () => {
      const { user, token: first } = await userWithResetToken('reset-newest');
      await requestReset(user.email).expect(202);
      const [, second] = await resetEmails(user.email, 2);
      await confirm({ token: first, password: NEW_PASSWORD }).expect(422);
      await confirm({ token: tokenFrom(second!), password: NEW_PASSWORD }).expect(204);
    });

    it('limits requests per email (429 with the wait)', async () => {
      const email = uniqueEmail('limited');
      for (let i = 0; i < 3; i += 1) await requestReset(email).expect(202);
      const blocked = await requestReset(email).expect(429);
      expect(ProblemDetailsSchema.parse(blocked.body).retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('rejects a malformed email with 422', async () => {
      await requestReset('not-an-email').expect(422);
    });
  });

  describe('confirm', () => {
    it('sets the new password: the new one logs in, the old one does not', async () => {
      const { user, token } = await userWithResetToken('reset-ok');
      await confirm({ token, password: NEW_PASSWORD }).expect(204);

      await api()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(401);
      await loginAs(app, { email: user.email, password: NEW_PASSWORD });
    });

    it('is single use', async () => {
      const { token } = await userWithResetToken('reset-once');
      await confirm({ token, password: NEW_PASSWORD }).expect(204);
      const again = await confirm({ token, password: `${NEW_PASSWORD}-2` }).expect(422);
      expect(ProblemDetailsSchema.parse(again.body).code).toBe('TOKEN_INVALID');
    });

    it('rejects an expired token', async () => {
      const { token } = await userWithResetToken('reset-expired');
      const row = (await tokenRow(token))!;
      await database.withContext({ userId: row.userId }, (tx) =>
        tx
          .update(oneTimeTokens)
          .set({ expiresAt: sql`now() - interval '1 second'` })
          .where(eq(oneTimeTokens.id, row.id)),
      );
      const response = await confirm({ token, password: NEW_PASSWORD }).expect(422);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('TOKEN_INVALID');
    });

    it('rejects an unknown token and an email-verification token', async () => {
      const unknown = await confirm({ token: 'A'.repeat(43), password: NEW_PASSWORD }).expect(422);
      expect(ProblemDetailsSchema.parse(unknown.body).code).toBe('TOKEN_INVALID');

      const email = uniqueEmail('verif');
      await api()
        .post('/api/v1/auth/register')
        .send({ name: 'Verif', email, password: NEW_PASSWORD })
        .expect(202);
      const [mail] = await waitForEmails(email);
      await confirm({ token: tokenFrom(mail!), password: NEW_PASSWORD }).expect(422);
    });

    it('applies the password policy and keeps the token usable after a rejection', async () => {
      const { token } = await userWithResetToken('reset-policy');
      const weak = await confirm({ token, password: 'password123' }).expect(422);
      expect(ProblemDetailsSchema.parse(weak.body).code).toBe('VALIDATION_FAILED');
      await confirm({ token, password: 'corta' }).expect(422);
      await confirm({ token, password: NEW_PASSWORD }).expect(204);
    });

    it('revokes every session of the user', async () => {
      const { user, token } = await userWithResetToken('reset-sessions');
      const first = await loginAs(app, user);
      const second = await loginAs(app, user);
      await api().get('/api/v1/auth/session').set('Cookie', first.cookie).expect(200);

      await confirm({ token, password: NEW_PASSWORD }).expect(204);

      for (const session of [first, second]) {
        await api().get('/api/v1/auth/session').set('Cookie', session.cookie).expect(401);
        expect(await withValkey((valkey) => valkey.exists(sessionKey(session.cookie)))).toBe(0);
      }
    });

    it('does not touch the sessions of other users', async () => {
      const { token } = await userWithResetToken('reset-mine');
      const other = await createVerifiedUser(app, database, 'reset-other');
      const session = await loginAs(app, other);
      await confirm({ token, password: NEW_PASSWORD }).expect(204);
      await api().get('/api/v1/auth/session').set('Cookie', session.cookie).expect(200);
    });

    it('emits the security events without secrets', async () => {
      const emit = vi.spyOn(SecurityEventLogger.prototype, 'emit');
      const { user, token } = await userWithResetToken('reset-events');
      await confirm({ token, password: NEW_PASSWORD }).expect(204);
      const events = emit.mock.calls.map(([event]) => event);
      expect(events).toContainEqual(
        expect.objectContaining({
          event: 'auth.password_reset_requested',
          outcome: 'success',
          userId: user.id,
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          event: 'auth.password_reset_completed',
          outcome: 'success',
          userId: user.id,
        }),
      );
      expect(JSON.stringify(events)).not.toContain(token);
      expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD);
      emit.mockRestore();
    });
  });
});

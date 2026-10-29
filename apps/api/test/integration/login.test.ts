import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemDetailsSchema, SessionInfoSchema } from '@cognitive-dag/contracts';
import { eq, sessions, type DatabaseClient } from '@cognitive-dag/db';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  loginAs,
  openDatabase,
  resetRateLimits,
  SESSION_COOKIE,
  sessionCookieFrom,
  startIdentityApp,
  STRONG_PASSWORD,
  uniqueEmail,
  type TestUser,
} from './identity-helpers';

describe('login (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let user: TestUser;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
    await resetRateLimits();
    user = await createVerifiedUser(app, database, 'login');
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  const login = (body: Record<string, unknown>) =>
    request(httpServer(app)).post('/api/v1/auth/login').send(body);

  it('starts a session: cookie, user, organizations and CSRF token', async () => {
    const response = await login({ email: user.email, password: user.password }).expect(200);

    const info = SessionInfoSchema.parse(response.body);
    expect(info.user).toEqual({ id: user.id, name: user.name, email: user.email });
    expect(info.organizations).toHaveLength(1);
    expect(info.organizations[0]).toMatchObject({ role: 'owner', isPersonal: true });

    const setCookie = (response.headers['set-cookie'] as unknown as string[]).find((line) =>
      line.startsWith(`${SESSION_COOKIE}=`),
    )!;
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(setCookie).toMatch(/;\s*Path=\//i);
    // __Host- cookies must not carry a Domain attribute.
    expect(setCookie).not.toMatch(/;\s*Domain=/i);
  });

  it('stores only the SHA-256 of the token and of the CSRF token', async () => {
    const session = await loginAs(app, user);
    const token = session.cookie.slice(SESSION_COOKIE.length + 1);
    const hash = createHash('sha256').update(token, 'utf8').digest();

    const [row] = await database.withContext({ userId: user.id }, (tx) =>
      tx.select().from(sessions).where(eq(sessions.tokenHash, hash)),
    );
    expect(row).toBeDefined();
    expect(row!.csrfTokenHash.equals(createHash('sha256').update(session.csrfToken).digest())).toBe(
      true,
    );
    expect(row!.revokedAt).toBeNull();
    const lifetimeMs = row!.expiresAt.getTime() - row!.createdAt.getTime();
    expect(lifetimeMs).toBeGreaterThan(11.9 * 3600_000);
    expect(lifetimeMs).toBeLessThan(12.1 * 3600_000);
  });

  it('answers the same 401 for a wrong password, an unknown email and an unverified account', async () => {
    const unverifiedEmail = uniqueEmail('unverified');
    await request(httpServer(app))
      .post('/api/v1/auth/register')
      .send({ name: 'Sin verificar', email: unverifiedEmail, password: STRONG_PASSWORD })
      .expect(202);

    const attempts = await Promise.all([
      login({ email: user.email, password: 'otra-contraseña-incorrecta' }),
      login({ email: uniqueEmail('ghost'), password: STRONG_PASSWORD }),
      login({ email: unverifiedEmail, password: STRONG_PASSWORD }),
    ]);

    for (const response of attempts) {
      expect(response.status).toBe(401);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    const bodies = attempts.map((response) => {
      const problem = ProblemDetailsSchema.parse(response.body);
      expect(problem.code).toBe('INVALID_CREDENTIALS');
      // Everything but the correlation id must be identical, so nothing reveals which case it was.
      const { correlationId: _id, ...rest } = problem;
      return rest;
    });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('rotates the session: the previous cookie of the browser stops working', async () => {
    const first = await loginAs(app, user);
    await request(httpServer(app))
      .get('/api/v1/auth/session')
      .set('Cookie', first.cookie)
      .expect(200);

    const second = await request(httpServer(app))
      .post('/api/v1/auth/login')
      .set('Cookie', first.cookie)
      .send({ email: user.email, password: user.password })
      .expect(200);
    const newCookie = sessionCookieFrom(second)!;

    expect(newCookie).not.toBe(first.cookie);
    await request(httpServer(app))
      .get('/api/v1/auth/session')
      .set('Cookie', first.cookie)
      .expect(401);
    await request(httpServer(app)).get('/api/v1/auth/session').set('Cookie', newCookie).expect(200);
  });

  it('returns the session, organizations and CSRF token of the cookie holder', async () => {
    const session = await loginAs(app, user);
    const response = await request(httpServer(app))
      .get('/api/v1/auth/session')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(SessionInfoSchema.parse(response.body).csrfToken).toBe(session.csrfToken);
  });

  it('answers 401 UNAUTHENTICATED without a cookie or with a garbage one', async () => {
    const without = await request(httpServer(app)).get('/api/v1/auth/session').expect(401);
    expect(ProblemDetailsSchema.parse(without.body).code).toBe('UNAUTHENTICATED');
    await request(httpServer(app))
      .get('/api/v1/auth/session')
      .set('Cookie', `${SESSION_COOKIE}=${'A'.repeat(43)}`)
      .expect(401);
  });

  it('rejects a malformed body with 422', async () => {
    await login({ email: user.email }).expect(422);
  });

  it('emits auth.login_succeeded and auth.login_failed without secrets', async () => {
    const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
    await login({ email: user.email, password: 'incorrecta-incorrecta' }).expect(401);
    const session = await loginAs(app, user);

    const events = emit.mock.calls.map(([event]) => event);
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'auth.login_failed', outcome: 'failure' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'auth.login_succeeded',
        outcome: 'success',
        userId: user.id,
      }),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(user.password);
    expect(serialized).not.toContain(session.cookie.slice(SESSION_COOKIE.length + 1));
    emit.mockRestore();
  });

  it('does not accept authenticated state changes through the F1 endpoints when the origin differs', async () => {
    const session = await loginAs(app, user);
    await request(httpServer(app))
      .post('/api/v1/auth/logout')
      .set(authHeaders(session, 'http://evil.example'))
      .expect(403);
  });
});

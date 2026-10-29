import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemDetailsSchema } from '@cognitive-dag/contracts';
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
  sessionKey,
  startIdentityApp,
  withValkey,
  type TestUser,
} from './identity-helpers';

describe('logout and expiry (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let user: TestUser;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
    await resetRateLimits();
    user = await createVerifiedUser(app, database, 'logout');
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  const whoAmI = (cookie: string) =>
    request(httpServer(app)).get('/api/v1/auth/session').set('Cookie', cookie);

  it('revokes the session at once, clears the cookie and rejects the old cookie', async () => {
    const session = await loginAs(app, user);
    await whoAmI(session.cookie).expect(200);

    const started = Date.now();
    const response = await request(httpServer(app))
      .post('/api/v1/auth/logout')
      .set(authHeaders(session))
      .expect(204);
    const reuse = await whoAmI(session.cookie).expect(401);
    expect(Date.now() - started).toBeLessThan(1_000);

    expect(ProblemDetailsSchema.parse(reuse.body).code).toBe('UNAUTHENTICATED');
    const cleared = (response.headers['set-cookie'] as unknown as string[]).find((line) =>
      line.startsWith(`${SESSION_COOKIE}=`),
    );
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    expect(await withValkey((valkey) => valkey.exists(sessionKey(session.cookie)))).toBe(0);
  });

  it('records the revocation in PostgreSQL with the reason logout', async () => {
    const session = await loginAs(app, user);
    await request(httpServer(app))
      .post('/api/v1/auth/logout')
      .set(authHeaders(session))
      .expect(204);

    const rows = await database.withContext({ userId: user.id }, (tx) =>
      tx.select().from(sessions).where(eq(sessions.userId, user.id)),
    );
    expect(rows.some((row) => row.revokeReason === 'logout' && row.revokedAt !== null)).toBe(true);
  });

  it('emits auth.logout', async () => {
    const emit = vi.spyOn(app.get(SecurityEventLogger), 'emit');
    const session = await loginAs(app, user);
    await request(httpServer(app))
      .post('/api/v1/auth/logout')
      .set(authHeaders(session))
      .expect(204);
    expect(emit.mock.calls.map(([event]) => event)).toContainEqual(
      expect.objectContaining({ event: 'auth.logout', outcome: 'success', userId: user.id }),
    );
    emit.mockRestore();
  });

  it('rejects a session past its 12-hour limit', async () => {
    const session = await loginAs(app, user);
    await whoAmI(session.cookie).expect(200);

    await database.withContext({ userId: user.id }, (tx) =>
      tx
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(sessions.userId, user.id)),
    );

    const response = await whoAmI(session.cookie).expect(401);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('UNAUTHENTICATED');
  });

  it('treats a missing Valkey key as expired and revokes with idle_timeout', async () => {
    const session = await loginAs(app, user);
    await whoAmI(session.cookie).expect(200);

    await withValkey((valkey) => valkey.del(sessionKey(session.cookie)));
    await whoAmI(session.cookie).expect(401);

    const rows = await database.withContext({ userId: user.id }, (tx) =>
      tx.select().from(sessions).where(eq(sessions.userId, user.id)),
    );
    expect(rows.some((row) => row.revokeReason === 'idle_timeout')).toBe(true);
  });

  it('renews the 2-hour idle window on every request', async () => {
    const session = await loginAs(app, user);
    const key = sessionKey(session.cookie);
    await withValkey((valkey) => valkey.expire(key, 60));

    await whoAmI(session.cookie).expect(200);

    const ttl = await withValkey((valkey) => valkey.ttl(key));
    expect(ttl).toBeGreaterThan(7_000);
    expect(ttl).toBeLessThanOrEqual(7_200);
  });
});

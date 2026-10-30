import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemDetailsSchema } from '@cognitive-dag/contracts';
import type { DatabaseClient } from '@cognitive-dag/db';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  loginAs,
  openDatabase,
  resetRateLimits,
  sessionKey,
  startIdentityApp,
  withValkey,
  type LoggedIn,
  type TestUser,
} from './identity-helpers';

const NEW_PASSWORD = 'otra-contraseña-nueva';

describe('password change (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let user: TestUser;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(async () => {
    await resetRateLimits();
    // A fresh user per test: a change alters the password the next test would log in with.
    user = await createVerifiedUser(app, database, 'change');
  });

  const api = () => request(httpServer(app));
  const change = (session: LoggedIn, body: Record<string, unknown>) =>
    api().post('/api/v1/auth/password/change').set(authHeaders(session)).send(body);

  it('changes the password: the new one logs in, the old one does not', async () => {
    const session = await loginAs(app, user);
    await change(session, { currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(
      204,
    );
    await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(401);
    await loginAs(app, { email: user.email, password: NEW_PASSWORD });
  });

  it('revokes the other sessions and keeps the current one', async () => {
    const current = await loginAs(app, user);
    const other = await loginAs(app, user);

    await change(current, { currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(
      204,
    );

    await api().get('/api/v1/auth/session').set('Cookie', current.cookie).expect(200);
    await api().get('/api/v1/auth/session').set('Cookie', other.cookie).expect(401);
    expect(await withValkey((valkey) => valkey.exists(sessionKey(other.cookie)))).toBe(0);
    expect(await withValkey((valkey) => valkey.exists(sessionKey(current.cookie)))).toBe(1);
  });

  it('rejects a wrong current password with 401 and leaves everything as it was', async () => {
    const session = await loginAs(app, user);
    const response = await change(session, {
      currentPassword: 'contraseña-equivocada-123',
      newPassword: NEW_PASSWORD,
    }).expect(401);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('INVALID_CREDENTIALS');
    await api().get('/api/v1/auth/session').set('Cookie', session.cookie).expect(200);
    await loginAs(app, user);
  });

  it('counts wrong current passwords toward the rate limit', async () => {
    const session = await loginAs(app, user);
    const wrong = { currentPassword: 'contraseña-equivocada-123', newPassword: NEW_PASSWORD };
    for (let i = 0; i < 5; i += 1) await change(session, wrong).expect(401);

    const blocked = await change(session, wrong).expect(429);
    expect(ProblemDetailsSchema.parse(blocked.body).retryAfterSeconds).toBeGreaterThan(0);
    // Even the right password waits: the limit stands until the wait is over.
    await change(session, { currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(
      429,
    );
  });

  it('applies the password policy to the new password', async () => {
    const session = await loginAs(app, user);
    const response = await change(session, {
      currentPassword: user.password,
      newPassword: 'password123',
    }).expect(422);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
    await change(session, { currentPassword: user.password, newPassword: 'corta' }).expect(422);
  });

  it('needs a session and the CSRF token', async () => {
    const session = await loginAs(app, user);
    const body = { currentPassword: user.password, newPassword: NEW_PASSWORD };
    await api().post('/api/v1/auth/password/change').send(body).expect(401);
    await api()
      .post('/api/v1/auth/password/change')
      .set('Cookie', session.cookie)
      .set('Origin', authHeaders(session).Origin)
      .send(body)
      .expect(403);
  });

  it('emits auth.password_changed, failure included, without secrets', async () => {
    const emit = vi.spyOn(SecurityEventLogger.prototype, 'emit');
    const session = await loginAs(app, user);
    await change(session, { currentPassword: 'equivocada-equivocada', newPassword: NEW_PASSWORD });
    await change(session, { currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(
      204,
    );
    const events = emit.mock.calls.map(([event]) => event);
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'auth.password_changed', outcome: 'failure' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'auth.password_changed',
        outcome: 'success',
        userId: user.id,
      }),
    );
    expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD);
    emit.mockRestore();
  });
});

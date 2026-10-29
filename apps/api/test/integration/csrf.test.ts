import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema } from '@cognitive-dag/contracts';
import type { DatabaseClient } from '@cognitive-dag/db';
import { httpServer, testConfig } from './helpers';
import {
  createVerifiedUser,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  type LoggedIn,
  type TestUser,
} from './identity-helpers';

describe('CSRF protection (requires docker compose up and pnpm db:migrate)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let alice: TestUser;
  let bob: TestUser;
  let aliceSession: LoggedIn;
  let bobSession: LoggedIn;
  const origin = testConfig().WEB_ORIGIN;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
    await resetRateLimits();
    alice = await createVerifiedUser(app, database, 'csrf-a');
    bob = await createVerifiedUser(app, database, 'csrf-b');
    aliceSession = await loginAs(app, alice);
    bobSession = await loginAs(app, bob);
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  beforeEach(resetRateLimits);

  // POST /organizations changes state and is not destructive, so the same session can be reused.
  const createOrganization = (headers: Record<string, string>) =>
    request(httpServer(app)).post('/api/v1/organizations').set(headers).send({ name: 'Equipo' });

  async function expectRejected(response: request.Test): Promise<void> {
    const result = await response.expect(403);
    expect(ProblemDetailsSchema.parse(result.body).code).toBe('CSRF_REJECTED');
  }

  it('rejects a state change without X-CSRF-Token', async () => {
    await expectRejected(createOrganization({ Cookie: aliceSession.cookie, Origin: origin }));
  });

  it('rejects the CSRF token of another session', async () => {
    await expectRejected(
      createOrganization({
        Cookie: aliceSession.cookie,
        'X-CSRF-Token': bobSession.csrfToken,
        Origin: origin,
      }),
    );
  });

  it('rejects a token of the right length that was never issued', async () => {
    await expectRejected(
      createOrganization({
        Cookie: aliceSession.cookie,
        'X-CSRF-Token': 'A'.repeat(43),
        Origin: origin,
      }),
    );
  });

  it('rejects a different Origin even with a valid token', async () => {
    await expectRejected(
      createOrganization({
        Cookie: aliceSession.cookie,
        'X-CSRF-Token': aliceSession.csrfToken,
        Origin: 'http://evil.example',
      }),
    );
  });

  it('rejects a request with a valid token but no Origin', async () => {
    await expectRejected(
      createOrganization({
        Cookie: aliceSession.cookie,
        'X-CSRF-Token': aliceSession.csrfToken,
      }),
    );
  });

  it('accepts the session own token from the web origin', async () => {
    await createOrganization({
      Cookie: aliceSession.cookie,
      'X-CSRF-Token': aliceSession.csrfToken,
      Origin: origin,
    }).expect(201);
  });

  it('does not ask for the token on safe methods', async () => {
    await request(httpServer(app))
      .get('/api/v1/auth/session')
      .set('Cookie', aliceSession.cookie)
      .expect(200);
  });

  it('rejects a login that comes from another origin', async () => {
    const response = await request(httpServer(app))
      .post('/api/v1/auth/login')
      .set('Origin', 'http://evil.example')
      .send({ email: alice.email, password: alice.password })
      .expect(403);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('CSRF_REJECTED');
  });

  it('allows credentials in CORS only for the web origin', async () => {
    const allowed = await request(httpServer(app))
      .options('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);
    expect(allowed.headers['access-control-allow-headers']).toMatch(/x-csrf-token/i);

    const denied = await request(httpServer(app))
      .options('/api/v1/auth/login')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    // The header names the web origin only, so a browser on another origin gets no access.
    expect(denied.headers['access-control-allow-origin']).toBe(origin);
  });
});

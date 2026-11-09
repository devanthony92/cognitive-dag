import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORRELATION_ID_HEADER } from '@cognitive-dag/contracts';
import type { DatabaseClient } from '@cognitive-dag/db';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  loginAs,
  openDatabase,
  resetRateLimits,
  SESSION_COOKIE,
  startIdentityApp,
  type LoggedIn,
} from './identity-helpers';
import { setupOrgPing } from './org-ping-helpers';

/**
 * Measured surface of the HTTP layer (F8, OWASP A02 and A05): the headers Helmet sets and the
 * attributes of the session cookie, pinned on real routes of each kind. A change to either must be
 * a decision, not an accident.
 */
const HELMET_HEADERS: Record<string, string | RegExp> = {
  // The defaults of Helmet 8; `style-src 'unsafe-inline'` is theirs and the API serves no HTML.
  'content-security-policy':
    "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';" +
    "frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';" +
    "script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'origin-agent-cluster': '?1',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-dns-prefetch-control': 'off',
  'x-download-options': 'noopen',
  'x-frame-options': 'SAMEORIGIN',
  'x-permitted-cross-domain-policies': 'none',
  'x-xss-protection': '0',
};

function expectSurface(response: request.Response): void {
  for (const [name, expected] of Object.entries(HELMET_HEADERS)) {
    const value = response.headers[name];
    if (typeof expected === 'string') expect(value, name).toBe(expected);
    else expect(value, name).toMatch(expected);
  }
  expect(response.headers['x-powered-by']).toBeUndefined();
  expect(response.headers['server']).toBeUndefined();
}

describe('security surface of the HTTP layer (requires docker compose up)', () => {
  let app: INestApplication;
  let database: DatabaseClient;
  let session: LoggedIn;
  let loginResponse: request.Response;

  beforeAll(async () => {
    app = await startIdentityApp();
    database = openDatabase();
    await resetRateLimits();
    const user = await createVerifiedUser(app, database, 'surface');
    loginResponse = await request(httpServer(app))
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    session = await loginAs(app, user);
  });

  afterAll(async () => {
    await app.close();
    await database.end();
  });

  it('sets the Helmet headers on the login response', () => {
    expectSurface(loginResponse);
  });

  it('sets them on the feature catalog, which answers with an empty object', async () => {
    const response = await request(httpServer(app))
      .get('/api/v1/features')
      .set(authHeaders(session))
      .expect(200);
    expect(response.body).toEqual({});
    expectSurface(response);
  });

  it('sets them on the health probes', async () => {
    for (const path of ['/health/live', '/health/ready']) {
      expectSurface(await request(httpServer(app)).get(path));
    }
  });

  it('sets them on the webhook, including its 401', async () => {
    const response = await request(httpServer(app))
      .post(`/api/v1/hooks/${randomUUID()}/cdw_${'A'.repeat(43)}`)
      .send({})
      .expect(401);
    expectSurface(response);
  });

  it('sets them on a problem+json error with a 404', async () => {
    expectSurface(await request(httpServer(app)).get(`/api/v1/${randomUUID()}`).expect(404));
  });

  it('fixes the attributes of the __Host-session cookie', () => {
    const lines = loginResponse.headers['set-cookie'] as unknown as string[];
    const cookies = lines.filter((line) => line.startsWith(`${SESSION_COOKIE}=`));
    expect(cookies).toHaveLength(1);
    const cookie = cookies[0]!;
    const attributes = cookie
      .split(';')
      .slice(1)
      .map((part) => part.trim());
    expect(attributes).toContain('HttpOnly');
    expect(attributes).toContain('Secure');
    expect(attributes).toContain('SameSite=Lax');
    expect(attributes).toContain('Path=/');
    // `__Host-` forbids a Domain; the cookie must expire, so it is not a session-only cookie by accident.
    expect(attributes.some((attribute) => /^Domain=/i.test(attribute))).toBe(false);
    expect(attributes.some((attribute) => /^Max-Age=\d+$/i.test(attribute))).toBe(true);
    const token = cookie.split(';')[0]!.slice(SESSION_COOKIE.length + 1);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('the only cookie the API sets is the session one', () => {
    const lines = loginResponse.headers['set-cookie'] as unknown as string[];
    for (const line of lines) expect(line.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  });
});

// A namespace that does not exist makes Temporal answer NOT_FOUND: neither a client mistake nor an
// outage, so it surfaces as an opaque 500.
describe('5xx responses (requires docker compose up)', () => {
  let env: Awaited<ReturnType<typeof setupOrgPing>>;
  const correlationId = randomUUID();

  beforeAll(async () => {
    env = await setupOrgPing({ TEMPORAL_NAMESPACE: `missing-${randomUUID()}` });
  });

  afterAll(async () => {
    await env.close();
  });

  it('carries no stack trace, internal name or framework header, and keeps the Helmet headers', async () => {
    const response = await env.post().set(CORRELATION_ID_HEADER, correlationId).send({});
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR', status: 500, correlationId });
    expect(JSON.stringify(response.body)).not.toMatch(
      /\bat\s.+\(|stack|Namespace|Error:|missing-|node_modules|\.ts|\.js:\d/,
    );
    expect(Object.keys(response.body as object).sort()).not.toContain('stack');
    expectSurface(response);
  });
});

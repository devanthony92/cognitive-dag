import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema } from '@cognitive-dag/contracts';
import {
  active,
  eq,
  memberships,
  oneTimeTokens,
  organizations,
  users,
  type DatabaseClient,
} from '@cognitive-dag/db';
import { httpServer } from './helpers';
import {
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  STRONG_PASSWORD,
  tokenFrom,
  uniqueEmail,
  waitForEmails,
} from './identity-helpers';

describe('registration (requires docker compose up and pnpm db:migrate)', () => {
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

  const register = (body: Record<string, unknown>) =>
    request(httpServer(app)).post('/api/v1/auth/register').send(body);

  it('creates the user, the personal organization and the owner membership', async () => {
    const email = uniqueEmail('ana');
    const response = await register({ name: 'Ana', email, password: STRONG_PASSWORD }).expect(202);
    expect(response.body).toEqual({
      message: 'Si los datos son correctos, recibirás un correo en breve.',
    });
    expect(response.headers['x-correlation-id']).toBeDefined();

    const rows = await database.withContext({ lookupEmail: email }, async (tx, extend) => {
      const [user] = await active.users(tx);
      await extend({ userId: user!.id });
      const [membership] = await active.memberships(tx);
      await extend({ organizationId: membership!.organizationId });
      const [organization] = await active.organizations(tx);
      const tokens = await tx
        .select()
        .from(oneTimeTokens)
        .where(eq(oneTimeTokens.userId, user!.id));
      return { user: user!, membership: membership!, organization: organization!, tokens };
    });
    expect(rows.user.name).toBe('Ana');
    expect(rows.user.emailVerifiedAt).toBeNull();
    expect(rows.user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(rows.user.passwordHash).not.toContain(STRONG_PASSWORD);
    expect(rows.organization.isPersonal).toBe(true);
    expect(rows.organization.createdBy).toBe(rows.user.id);
    expect(rows.membership.role).toBe('owner');
    expect(rows.membership.userId).toBe(rows.user.id);
    expect(rows.tokens).toHaveLength(1);
    expect(rows.tokens[0]!.purpose).toBe('email_verification');
  });

  it('sends a verification email whose token is stored only as its SHA-256', async () => {
    const email = uniqueEmail('mail');
    await register({ name: 'Mail', email, password: STRONG_PASSWORD }).expect(202);
    const [message] = await waitForEmails(email);
    const token = tokenFrom(message!);
    expect(message!.text).toContain('/verify-email?token=');
    expect(message!.headers['X-Correlation-Id']?.[0]).toMatch(/^[0-9a-f-]{36}$/);

    const stored = await database.withContext(
      { lookupTokenHash: createHash('sha256').update(token).digest('hex') },
      (tx) => tx.select().from(oneTimeTokens),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash.toString('hex')).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(stored[0]!.tokenHash.toString('utf8')).not.toContain(token);
    const hours = (stored[0]!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it('normalizes the email', async () => {
    const email = uniqueEmail('norm');
    await register({
      name: 'Norm',
      email: `  ${email.toUpperCase()} `,
      password: STRONG_PASSWORD,
    }).expect(202);
    const found = await database.withContext({ lookupEmail: email }, (tx) => active.users(tx));
    expect(found).toHaveLength(1);
    expect(found[0]!.email).toBe(email);
  });

  it('answers an existing email exactly like a new one and warns its owner', async () => {
    const email = uniqueEmail('dup');
    const first = await register({ name: 'Uno', email, password: STRONG_PASSWORD }).expect(202);
    await waitForEmails(email);
    const second = await register({
      name: 'Otro',
      email,
      password: 'otra contraseña distinta',
    }).expect(202);

    expect(second.body).toEqual(first.body);
    expect(second.headers['content-type']).toBe(first.headers['content-type']);

    const messages = await waitForEmails(email, 2);
    expect(messages).toHaveLength(2);
    expect(messages[1]!.subject).toMatch(/intento de registro/i);
    expect(messages[1]!.text).not.toMatch(/token=/);
    const found = await database.withContext({ lookupEmail: email }, (tx) => active.users(tx));
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe('Uno');
  });

  it('creates a single account when the same email registers concurrently', async () => {
    const email = uniqueEmail('race');
    const responses = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        register({ name: `Race ${index}`, email, password: STRONG_PASSWORD }),
      ),
    );
    // Per-email limit is 3 per hour: all three are accepted and indistinguishable.
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202]);
    const found = await database.withContext({ lookupEmail: email }, (tx) => active.users(tx));
    expect(found).toHaveLength(1);
    const orgs = await database.withContext({ userId: found[0]!.id }, (tx) =>
      active.organizations(tx, eq(organizations.createdBy, found[0]!.id)),
    );
    expect(orgs).toHaveLength(1);
    const members = await database.withContext(
      { userId: found[0]!.id, organizationId: orgs[0]!.id },
      (tx) => active.memberships(tx, eq(memberships.userId, found[0]!.id)),
    );
    expect(members).toHaveLength(1);
    expect(users).toBeDefined();
  });

  it.each([
    ['14 characters', 'x7Qm-vR2!kLp9z', /al menos 15/],
    ['129 characters', 'qZ3v-'.repeat(26).slice(0, 129), /como máximo 128/],
    ['a common password', 'password123456789', /demasiado común/],
  ])('rejects %s with errors[] on password', async (_case, password, message) => {
    const response = await register({ name: 'Ana', email: uniqueEmail('bad'), password }).expect(
      422,
    );
    const problem = ProblemDetailsSchema.parse(response.body);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors).toContainEqual({
      field: 'password',
      message: expect.stringMatching(message) as string,
    });
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('rejects malformed bodies', async () => {
    const response = await register({
      name: '',
      email: 'no-es-email',
      password: STRONG_PASSWORD,
    }).expect(422);
    const fields = ProblemDetailsSchema.parse(response.body).errors?.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'email']));
  });

  it('answers 429 with Retry-After after too many attempts for one email', async () => {
    const email = uniqueEmail('limit');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await register({ name: 'Ana', email, password: STRONG_PASSWORD }).expect(202);
    }
    const response = await register({ name: 'Ana', email, password: STRONG_PASSWORD }).expect(429);
    const problem = ProblemDetailsSchema.parse(response.body);
    expect(problem.code).toBe('RATE_LIMITED');
    expect(problem.retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(response.headers['retry-after'])).toBe(problem.retryAfterSeconds);
    expect(await waitForEmails(email, 3)).toHaveLength(3);
  });

  it('answers 429 after too many registrations from one IP', async () => {
    let last = 202;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await register({
        name: 'Ana',
        email: uniqueEmail('ip'),
        password: STRONG_PASSWORD,
      });
      last = response.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('identity flag off', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startIdentityApp('{"ping-enabled":true,"identity-enabled":false}');
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/api/v1/auth/register'],
    ['/api/v1/auth/verify-email'],
    ['/api/v1/auth/verify-email/resend'],
  ])('answers 404 FEATURE_NOT_AVAILABLE on %s', async (path) => {
    const response = await request(httpServer(app)).post(path).send({}).expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('FEATURE_NOT_AVAILABLE');
  });
});

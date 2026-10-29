import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SessionInfo } from '@cognitive-dag/contracts';
import { active, createDatabase, eq, users, type DatabaseClient } from '@cognitive-dag/db';
import Valkey from 'iovalkey';
import type { AppConfig } from '../../src/config/env.schema';
import { httpServer, startTestApp, testConfig } from './helpers';

export const IDENTITY_FLAGS = '{"ping-enabled":true,"identity-enabled":true}';

export const STRONG_PASSWORD = 'un-caballo-azul-en-marte';

export function startIdentityApp(
  flags = IDENTITY_FLAGS,
  overrides: Partial<AppConfig> = {},
): Promise<INestApplication> {
  return startTestApp({ FEATURE_FLAGS: flags, ...overrides });
}

export function uniqueEmail(label = 'user'): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Connection as app_runtime, the same role the API uses. */
export function openDatabase(): DatabaseClient {
  return createDatabase({ connectionString: testConfig().DATABASE_URL, max: 4 });
}

/** Rate-limit counters persist in Valkey across runs; every test starts from zero. */
export async function resetRateLimits(): Promise<void> {
  const valkey = new Valkey(testConfig().VALKEY_URL);
  try {
    const keys = await valkey.keys('rl:*');
    if (keys.length > 0) await valkey.del(...keys);
  } finally {
    valkey.disconnect();
  }
}

export interface CapturedEmail {
  id: string;
  subject: string;
  text: string;
  to: string[];
  headers: Record<string, string[]>;
}

const mailpitUrl = () => process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${mailpitUrl()}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Messages sent to an address, oldest first, read through Mailpit's HTTP API. */
export async function emailsTo(address: string): Promise<CapturedEmail[]> {
  const search = await fetchJson<{ messages: MailpitSummary[] }>(
    `/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  const messages = await Promise.all(
    [...search.messages].reverse().map(async (summary) => {
      const detail = await fetchJson<{ Text: string }>(`/api/v1/message/${summary.ID}`);
      const headers = await fetchJson<Record<string, string[]>>(
        `/api/v1/message/${summary.ID}/headers`,
      );
      return {
        id: summary.ID,
        subject: summary.Subject,
        text: detail.Text,
        to: summary.To.map((to) => to.Address),
        headers,
      };
    }),
  );
  return messages;
}

/** Waits until at least `count` messages reached the address (mail is sent after the commit). */
export async function waitForEmails(address: string, count = 1): Promise<CapturedEmail[]> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const found = await emailsTo(address);
    if (found.length >= count) return found;
    if (Date.now() > deadline) throw new Error(`No ${count} email(s) for ${address} in time`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** The 43-character token carried by the link of an email body. */
export function tokenFrom(email: CapturedEmail): string {
  const match = /[?&]token=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(email.text);
  if (!match?.[1]) throw new Error(`No token in email "${email.subject}"`);
  return match[1];
}

export const SESSION_COOKIE = '__Host-session';

export interface TestUser {
  id: string;
  name: string;
  email: string;
  password: string;
}

export interface LoggedIn {
  /** Value for the Cookie request header. */
  cookie: string;
  csrfToken: string;
  body: SessionInfo;
}

/** Registers through the API and marks the email as verified directly (mail has its own tests). */
export async function createVerifiedUser(
  app: INestApplication,
  database: DatabaseClient,
  label = 'user',
): Promise<TestUser> {
  const email = uniqueEmail(label);
  const name = `Test ${label}`;
  await request(httpServer(app))
    .post('/api/v1/auth/register')
    .send({ name, email, password: STRONG_PASSWORD })
    .expect(202);
  const id = await database.withContext({ lookupEmail: email }, async (tx, extend) => {
    const [user] = await active.users(tx);
    await extend({ userId: user!.id });
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user!.id));
    return user!.id;
  });
  return { id, name, email, password: STRONG_PASSWORD };
}

/** The `__Host-session=<token>` pair of a Set-Cookie header, or undefined if none was sent. */
export function sessionCookieFrom(response: request.Response): string | undefined {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const line = header?.find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  return line?.split(';')[0];
}

export async function loginAs(
  app: INestApplication,
  user: Pick<TestUser, 'email' | 'password'>,
): Promise<LoggedIn> {
  const response = await request(httpServer(app))
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
  const cookie = sessionCookieFrom(response);
  if (!cookie) throw new Error('Login did not set the session cookie');
  const body = response.body as SessionInfo;
  return { cookie, csrfToken: body.csrfToken, body };
}

/** Request headers of an authenticated, state-changing browser request. */
export function authHeaders(session: LoggedIn, origin = testConfig().WEB_ORIGIN) {
  return { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, Origin: origin };
}

export function sessionKey(cookie: string): string {
  const token = cookie.slice(SESSION_COOKIE.length + 1);
  return `sess:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

/** Runs `fn` with a Valkey client of its own, e.g. to drop a session key. */
export async function withValkey<T>(fn: (valkey: Valkey) => Promise<T>): Promise<T> {
  const valkey = new Valkey(testConfig().VALKEY_URL);
  try {
    return await fn(valkey);
  } finally {
    valkey.disconnect();
  }
}

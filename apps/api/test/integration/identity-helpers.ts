import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import Valkey from 'iovalkey';
import { startTestApp, testConfig } from './helpers';

export const IDENTITY_FLAGS = '{"ping-enabled":true,"identity-enabled":true}';

export const STRONG_PASSWORD = 'un-caballo-azul-en-marte';

export function startIdentityApp(flags = IDENTITY_FLAGS): Promise<INestApplication> {
  return startTestApp({ FEATURE_FLAGS: flags });
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

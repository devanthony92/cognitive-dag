import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_TOKEN_PATTERN, WEBHOOK_TOKEN_PREFIX } from '@cognitive-dag/contracts';

/** The token of a webhook: `cdw_` plus 256 random bits in base64url (research R2). */
export function generateWebhookToken(): string {
  return `${WEBHOOK_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** What the database keeps: the SHA-256 of the token, never the token. */
export function hashWebhookToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

// A fixed hash to compare against when the trigger does not exist, so "no such trigger" and "wrong
// token" take the same work and answer the same way.
const ABSENT_HASH = hashWebhookToken('cdw_absent-trigger-comparison-only');

/**
 * Constant-time check of a presented token against the stored hash. A token with the wrong shape or
 * a missing trigger still goes through one comparison; the result is `false` in every such case.
 */
export function webhookTokenMatches(presented: string, stored: Buffer | undefined): boolean {
  const shaped = WEBHOOK_TOKEN_PATTERN.test(presented);
  const candidate = hashWebhookToken(shaped ? presented : 'cdw_malformed');
  const equal = timingSafeEqual(candidate, stored ?? ABSENT_HASH);
  return shaped && stored !== undefined && equal;
}

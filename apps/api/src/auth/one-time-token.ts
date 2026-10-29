import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes as base64url (43 characters): the only form that travels in emails and bodies. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of the token: the only form that is stored. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Hex form used as `app.lookup_token_hash` in the row-level security context. */
export function hashTokenHex(token: string): string {
  return hashToken(token).toString('hex');
}

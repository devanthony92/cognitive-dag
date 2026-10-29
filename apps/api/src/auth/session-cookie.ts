import type { CookieOptions, Request } from 'express';
import { SESSION_ABSOLUTE_TTL_MS } from './session.service';

/** `__Host-` pins the cookie to this host over HTTPS: no Domain, Path=/, Secure (R5). */
export const SESSION_COOKIE = '__Host-session';

export const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

export const SESSION_COOKIE_MAX_AGE_MS = SESSION_ABSOLUTE_TTL_MS;

/** Reads one cookie without a parser dependency; undefined when absent or empty. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}

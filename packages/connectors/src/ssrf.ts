import { isPublicAddress, normalizeIpLiteral, type AddressOptions } from './address.js';
import { isHostAllowed } from './allowlist.js';
import { ConnectorError, DESTINATION_BLOCKED_MESSAGE, SsrfError } from './errors.js';

export interface DestinationOptions extends AddressOptions {
  /** Allowlist of the organization; empty or absent means only the address rules apply. */
  allowlist?: readonly string[];
}

/** Parses a URL and keeps only what the guard accepts: https, no user info (research R9.1). */
export function parseHttpsUrl(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalidUrl();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === ''
  ) {
    throw invalidUrl();
  }
  return url;
}

function invalidUrl(): ConnectorError {
  return new ConnectorError(
    'HTTP_URL_INVALID',
    'permanent',
    'La URL no es válida: debe usar https y no llevar usuario ni contraseña.',
  );
}

/**
 * Checks a URL before any name is resolved (research R9.1, R9.7): an IP literal must be public, and
 * the host must be on the allowlist when the organization has one. Runs on the first request and on
 * every redirect hop. Names are checked again, address by address, in the guarded lookup.
 */
export function assertDestination(url: URL, options: DestinationOptions = {}): void {
  const host = url.hostname;
  if (normalizeIpLiteral(host) !== undefined && !isPublicAddress(host, options)) {
    throw new SsrfError();
  }
  if (!isHostAllowed(host, options.allowlist ?? [])) {
    throw new ConnectorError('HTTP_HOST_NOT_ALLOWED', 'permanent', DESTINATION_BLOCKED_MESSAGE);
  }
}

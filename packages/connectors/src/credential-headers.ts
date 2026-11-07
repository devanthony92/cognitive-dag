import { CredentialCryptoError } from './errors.js';

export type CredentialKind = 'bearer' | 'api_key_header' | 'basic';

/**
 * Names an `api_key_header` credential may not use (research R10), in lower case. `Proxy-*` is a
 * prefix rule, applied apart. `@cognitive-dag/contracts` keeps the same list; a test fixes both.
 */
export const FORBIDDEN_CREDENTIAL_HEADER_NAMES: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'content-type',
  'transfer-encoding',
  'connection',
  'cookie',
  'set-cookie',
  'authorization',
  'idempotency-key',
]);

const HEADER_TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
// Any control character, which includes CR and LF: a value must not be able to split a header.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type HeaderNameResult = { ok: true } | { ok: false; reason: string };

/** Checks the name of an `api_key_header` credential (research R10). */
export function validateHeaderName(name: string): HeaderNameResult {
  if (!HEADER_TOKEN.test(name)) {
    return { ok: false, reason: 'El nombre de la cabecera no es válido.' };
  }
  const lower = name.toLowerCase();
  if (FORBIDDEN_CREDENTIAL_HEADER_NAMES.has(lower) || lower.startsWith('proxy-')) {
    return { ok: false, reason: 'Ese nombre de cabecera está reservado.' };
  }
  return { ok: true };
}

export interface CredentialHeaderInput {
  kind: CredentialKind;
  /** Only for `api_key_header`. */
  headerName?: string | null;
  secret: string;
}

function invalidSecret(): CredentialCryptoError {
  return new CredentialCryptoError(
    'CREDENTIAL_SECRET_INVALID',
    'El secreto de la credencial no es válido.',
  );
}

function invalidHeader(): CredentialCryptoError {
  return new CredentialCryptoError(
    'CREDENTIAL_HEADER_INVALID',
    'La cabecera de la credencial no es válida.',
  );
}

/**
 * The one header a credential adds to a request (research R10). Errors never repeat the secret.
 * - `bearer`: `Authorization: Bearer <secret>`.
 * - `api_key_header`: `<headerName>: <secret>`.
 * - `basic`: `Authorization: Basic base64(user:password)`; the secret is `user:password`.
 */
export function buildCredentialHeader(input: CredentialHeaderInput): {
  name: string;
  value: string;
} {
  const { kind, secret } = input;
  if (secret.length === 0 || CONTROL_CHARACTERS.test(secret)) throw invalidSecret();
  const hasHeaderName = input.headerName !== undefined && input.headerName !== null;
  if (kind === 'api_key_header') {
    if (!hasHeaderName || !validateHeaderName(input.headerName as string).ok) throw invalidHeader();
    return { name: input.headerName as string, value: secret };
  }
  if (hasHeaderName) throw invalidHeader();
  if (kind === 'bearer') return { name: 'Authorization', value: `Bearer ${secret}` };
  const colon = secret.indexOf(':');
  if (colon < 1) throw invalidSecret();
  return {
    name: 'Authorization',
    value: `Basic ${Buffer.from(secret, 'utf8').toString('base64')}`,
  };
}

import { ConnectorError } from './errors.js';
import { parseHttpsUrl } from './ssrf.js';

/** Redirect hops the client follows (research R9.5). */
export const MAX_REDIRECTS = 3;

/** Status codes the client treats as a redirect. */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export interface CredentialHeader {
  name: string;
  value: string;
}

/** Everything that defines one request of the chain, so each hop can derive the next. */
export interface RequestState {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  credentialHeader?: CredentialHeader;
  idempotencyKey?: string;
}

const BODY_HEADERS = new Set(['content-type', 'content-length', 'content-encoding']);

function notAllowed(): ConnectorError {
  return new ConnectorError(
    'HTTP_REDIRECT_NOT_ALLOWED',
    'permanent',
    'La respuesta redirige a un destino que no se puede seguir.',
  );
}

/**
 * The request that follows a redirect (research R9.5). `hopsDone` counts the hops already followed:
 * the fourth redirect fails. Only https is followed; a hop to another origin (scheme, host or port)
 * drops the credential header and `Idempotency-Key`; `303`, and `301`/`302` of a `POST`, become `GET`
 * without a body; `307` and `308` keep method and body. The caller validates the new URL (address and
 * allowlist) before connecting.
 */
export function nextHop(
  current: RequestState,
  status: number,
  location: string | undefined,
  hopsDone: number,
): RequestState {
  if (hopsDone >= MAX_REDIRECTS) {
    throw new ConnectorError(
      'HTTP_TOO_MANY_REDIRECTS',
      'permanent',
      'La respuesta tiene demasiadas redirecciones.',
    );
  }
  if (location === undefined || location === '') throw notAllowed();
  let target: URL;
  try {
    target = parseHttpsUrl(new URL(location, current.url).href);
  } catch {
    throw notAllowed();
  }

  const toGet = status === 303 || ((status === 301 || status === 302) && current.method === 'POST');
  const next: RequestState = {
    url: target,
    method: toGet ? 'GET' : current.method,
    headers: { ...current.headers },
  };
  if (toGet) {
    for (const name of Object.keys(next.headers)) {
      if (BODY_HEADERS.has(name.toLowerCase())) delete next.headers[name];
    }
  } else if (current.body !== undefined) {
    next.body = current.body;
  }
  if (target.origin === current.url.origin) {
    if (current.credentialHeader) next.credentialHeader = current.credentialHeader;
    if (current.idempotencyKey !== undefined) next.idempotencyKey = current.idempotencyKey;
  }
  return next;
}

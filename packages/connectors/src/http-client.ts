import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createGuardedLookup, type ResolveFn } from './dns-lookup.js';
import { ConnectorError, SsrfError } from './errors.js';
import {
  nextHop,
  REDIRECT_STATUSES,
  type CredentialHeader,
  type RequestState,
} from './redirect.js';
import { assertDestination, parseHttpsUrl } from './ssrf.js';
import { normalizeIpLiteral } from './address.js';

/** Largest response body the client reads (research R11). */
export const MAX_RESPONSE_BYTES = 1_048_576;
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
export const USER_AGENT = 'CognitiveDAG/1';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface GuardedRequestOptions {
  url: string;
  method: HttpMethod;
  /** Headers of the node definition; the system-managed ones are refused. */
  headers?: Record<string, string>;
  body?: string;
  /** The one header of the credential (research R10). Dropped on a hop to another origin. */
  credentialHeader?: CredentialHeader;
  /** `runId:nodeId`, sent on every method that has an effect. Dropped on a hop to another origin. */
  idempotencyKey?: string;
  /** Allowlist of the organization; empty or absent means only the address rules apply. */
  allowlist?: readonly string[];
  /** Tests only (`HTTP_TEST_ALLOW_LOOPBACK`). */
  allowLoopback?: boolean;
  /** Injected name resolution (fake DNS in tests); defaults to the system resolver. */
  resolve?: ResolveFn;
  /** Extra trust anchors for the test server certificate. */
  tls?: { ca?: string | Buffer };
  /** Time to connect and finish the TLS handshake, for each hop. */
  connectTimeoutMs?: number;
  /** Time for the whole call, redirects included. */
  totalTimeoutMs?: number;
}

export interface GuardedResponse {
  status: number;
  /** Lower-case names; repeated headers are joined with a comma. */
  headers: Record<string, string>;
  /** UTF-8 text. Empty for a non-2xx response whose content the client does not read. */
  body: string;
}

const FORBIDDEN_NODE_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'idempotency-key',
  'user-agent',
  'cookie',
  'set-cookie',
  'authorization',
]);
const HEADER_TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const EFFECT_METHODS = new Set<string>(['POST', 'PUT', 'PATCH', 'DELETE']);

const TLS_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'HOSTNAME_MISMATCH',
]);

function forbiddenHeader(): ConnectorError {
  return new ConnectorError(
    'HTTP_HEADER_FORBIDDEN',
    'permanent',
    'Una cabecera de la petición no está permitida.',
  );
}

function timeout(): ConnectorError {
  return new ConnectorError('HTTP_TIMEOUT', 'timeout', 'La petición HTTP superó el tiempo máximo.');
}

function checkNodeHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      !HEADER_TOKEN.test(name) ||
      FORBIDDEN_NODE_HEADERS.has(lower) ||
      lower.startsWith('proxy-') ||
      CONTROL_CHARACTERS.test(value)
    ) {
      throw forbiddenHeader();
    }
  }
}

function wireHeaders(state: RequestState): Record<string, string> {
  const headers: Record<string, string> = { ...state.headers };
  const has = (name: string): boolean =>
    Object.keys(headers).some((key) => key.toLowerCase() === name);
  headers['User-Agent'] = USER_AGENT;
  if (state.body !== undefined && state.body !== '') {
    if (!has('content-type')) headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(state.body, 'utf8'));
  }
  if (state.credentialHeader) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === state.credentialHeader.name.toLowerCase()) delete headers[key];
    }
    headers[state.credentialHeader.name] = state.credentialHeader.value;
  }
  if (state.idempotencyKey !== undefined && EFFECT_METHODS.has(state.method)) {
    headers['Idempotency-Key'] = state.idempotencyKey;
  }
  return headers;
}

function supportedContentType(contentType: string): boolean {
  const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return (
    type === 'application/json' ||
    (type.startsWith('application/') && type.endsWith('+json')) ||
    type.startsWith('text/')
  );
}

function classify(error: unknown, blocked: Error | undefined): ConnectorError {
  if (blocked) return blocked as ConnectorError;
  if (error instanceof ConnectorError) return error;
  const code = String((error as NodeJS.ErrnoException | undefined)?.code ?? '');
  const message = error instanceof Error ? error.message : '';
  if (
    TLS_ERROR_CODES.has(code) ||
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    /certificate|handshake|ssl routines/i.test(message)
  ) {
    return new ConnectorError(
      'HTTP_TLS_ERROR',
      'permanent',
      'No se pudo verificar la conexión segura con el destino.',
    );
  }
  return new ConnectorError(
    'HTTP_NETWORK_ERROR',
    'transient',
    'No se pudo conectar con el destino.',
  );
}

interface Hop {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** One request, without redirects. Rejects with a `ConnectorError`. */
function sendOnce(
  state: RequestState,
  options: GuardedRequestOptions,
  remainingMs: number,
): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    const hostname = state.url.hostname.replace(/^\[|\]$/g, '');
    const literal = normalizeIpLiteral(hostname) !== undefined;
    const guarded = createGuardedLookup({
      ...(options.resolve ? { resolve: options.resolve } : {}),
      ...(options.allowLoopback ? { allowLoopback: true } : {}),
    });
    let blocked: Error | undefined;
    let settled = false;
    let connectTimer: NodeJS.Timeout | undefined;
    // Both timers call `failWith`, which exists by the time either one fires.
    const totalTimer = setTimeout(() => failWith(timeout()), Math.max(1, remainingMs));

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      action();
    };

    const request = httpsRequest({
      hostname,
      port: state.url.port === '' ? 443 : Number(state.url.port),
      path: `${state.url.pathname}${state.url.search}`,
      method: state.method,
      headers: wireHeaders(state),
      // A private agent per call: no keep-alive, no shared pool and no proxy from the environment.
      agent: false,
      lookup: (host, lookupOptions, callback) =>
        guarded(host, lookupOptions, (error, address, family) => {
          if (error instanceof SsrfError) blocked = error;
          (callback as (...args: unknown[]) => void)(error, address, family);
        }),
      ...(literal ? {} : { servername: hostname }),
      ...(options.tls?.ca ? { ca: options.tls.ca } : {}),
    });

    const fail = (error: unknown): void => {
      finish(() => {
        request.destroy();
        reject(classify(error, blocked));
      });
    };
    const failWith = (error: ConnectorError): void => {
      finish(() => {
        request.destroy();
        reject(error);
      });
    };

    request.on('socket', (socket) => {
      connectTimer = setTimeout(
        () => failWith(timeout()),
        options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      );
      socket.once('secureConnect', () => clearTimeout(connectTimer));
    });
    // Errors after the call settled (a body longer than announced, a reset) are not news.
    request.on('error', fail);

    request.on('response', (response: IncomingMessage) => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') headers[name] = value;
        else if (Array.isArray(value)) headers[name] = value.join(', ');
      }
      const status = response.statusCode ?? 0;
      const done = (body: string): void =>
        finish(() => {
          request.destroy();
          resolve({ status, headers, body });
        });

      if (REDIRECT_STATUSES.has(status) || status === 204 || status === 205 || status === 304) {
        response.destroy();
        done('');
        return;
      }
      const strict = status >= 200 && status < 300;
      const contentType = headers['content-type'];
      const unsupported = contentType !== undefined && !supportedContentType(contentType);
      if (!strict && unsupported) {
        response.destroy();
        done('');
        return;
      }
      if (strict && unsupported) {
        failWith(unsupportedType());
        return;
      }
      const declared = Number(headers['content-length']);
      if (strict && Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        failWith(tooLarge());
        return;
      }

      const chunks: Buffer[] = [];
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received <= MAX_RESPONSE_BYTES) {
          chunks.push(chunk);
          return;
        }
        if (strict) {
          failWith(tooLarge());
          return;
        }
        // A non-2xx body is only context: keep what fits and stop reading.
        chunks.push(chunk.subarray(0, Math.max(0, MAX_RESPONSE_BYTES - (received - chunk.length))));
        response.destroy();
        done(Buffer.concat(chunks).toString('utf8'));
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        if (strict && contentType === undefined && body.length > 0) {
          failWith(unsupportedType());
          return;
        }
        done(body.toString('utf8'));
      });
      response.on('error', fail);
      response.on('aborted', () => fail(new Error('aborted')));
    });

    if (state.body !== undefined && state.body !== '') request.write(state.body, 'utf8');
    request.end();
  });
}

function tooLarge(): ConnectorError {
  return new ConnectorError(
    'HTTP_RESPONSE_TOO_LARGE',
    'permanent',
    'La respuesta supera el tamaño máximo permitido (1 MiB).',
  );
}

function unsupportedType(): ConnectorError {
  return new ConnectorError(
    'HTTP_CONTENT_TYPE_UNSUPPORTED',
    'permanent',
    'El tipo de contenido de la respuesta no está soportado.',
  );
}

/**
 * The outbound HTTP call of F7 (research R9, R11): https only, no proxy, every address validated and
 * the socket opened on the validated address, redirects followed by hand and revalidated, response
 * bounded to 1 MiB of JSON or text. 4xx and 5xx are returned as responses; classifying them is up to
 * the caller. Failures are `ConnectorError`s with a stable code and a message free of the URL.
 */
export async function guardedRequest(options: GuardedRequestOptions): Promise<GuardedResponse> {
  const destination = {
    ...(options.allowlist ? { allowlist: options.allowlist } : {}),
    ...(options.allowLoopback ? { allowLoopback: true } : {}),
  };
  checkNodeHeaders(options.headers ?? {});
  const total = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const deadline = Date.now() + total;

  let state: RequestState = {
    url: parseHttpsUrl(options.url),
    method: options.method,
    headers: { ...options.headers },
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.credentialHeader ? { credentialHeader: options.credentialHeader } : {}),
    ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
  };

  for (let hops = 0; ; hops += 1) {
    assertDestination(state.url, destination);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeout();
    const hop = await sendOnce(state, options, remaining);
    if (REDIRECT_STATUSES.has(hop.status)) {
      state = nextHop(state, hop.status, hop.headers['location'], hops);
      continue;
    }
    return hop;
  }
}

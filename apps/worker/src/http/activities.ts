import { Context } from '@temporalio/activity';
import { ERROR_CLASS_CODES } from '@cognitive-dag/dag-schema';
import {
  ConnectorError,
  countsAsBreakerFailure,
  guardedRequest,
  type CallOutcome,
  type DnsAnswer,
  type GuardedResponse,
  type HttpMethod,
  type ResolveFn,
} from '@cognitive-dag/connectors';
import type { Logger } from '@cognitive-dag/logger';
import {
  NodeFailure,
  runWithPolicy,
  toApplicationFailure,
  type AttemptPolicy,
} from '../resilience/attempts';
import { idempotencyKeyFor, type EffectStore } from '../resilience/effects';
import type { RateLimiter } from '../resilience/rate-limiter';
import type { WorkerSecurityEvent } from '../logging/security-events';
import type { CircuitBreaker } from './circuit-breaker';
import type { CredentialHeader, CredentialResolver } from './credentials';

export type { DnsAnswer, ResolveFn };

export interface HttpRequestInput {
  runId: string;
  nodeId: string;
  correlationId: string;
  organizationId: string;
  /** Effective policy of the node; the activity counts its own attempts (F4, research R3). */
  policy: AttemptPolicy;
  /** The config of the node with its templates already resolved by the interpreter. */
  config: {
    method: HttpMethod;
    url: string;
    headers: Record<string, string>;
    body: string;
    credentialId?: string;
  };
}

export interface HttpRequestResult {
  /** Neither the body nor the URL are ever written outside the Temporal history. */
  output: { status: number; body: string };
  attempts: number;
}

export interface HttpActivities {
  httpRequest(input: HttpRequestInput): Promise<HttpRequestResult>;
}

/** The step starts or stops waiting (`null`) for the rate limit or the circuit breaker. */
export interface HttpWaitingMark {
  organizationId: string;
  runId: string;
  correlationId: string;
  nodeId: string;
  waitingReason: 'rate_limited' | 'circuit_open' | null;
}

export interface HttpActivityOptions {
  logger: Logger;
  /** `HTTP_ENABLED`: false fails every call `HTTP_DISABLED` without touching the destination. */
  enabled: boolean;
  credentials: CredentialResolver;
  breaker: CircuitBreaker;
  /** Longest a node waits for an open circuit, from when the activity was scheduled. */
  breakerMaxWaitMs: number;
  rateLimiter?: RateLimiter;
  /** Records the effect of the methods that have one (F4). */
  effects?: EffectStore;
  markWaiting?: (mark: HttpWaitingMark) => Promise<void>;
  /** Tests only: `HTTP_TEST_ALLOW_LOOPBACK`, a fake DNS and the certificate of the local server. */
  allowLoopback?: boolean;
  resolve?: ResolveFn;
  tls?: { ca?: string | Buffer };
  /** Source of randomness for the jitter of the waits; replaced in tests. */
  random?: () => number;
}

export const HTTP_ERROR_CODES = {
  disabled: 'HTTP_DISABLED',
  circuitOpen: 'HTTP_CIRCUIT_OPEN',
  circuitUnavailable: 'HTTP_CIRCUIT_UNAVAILABLE',
  serverError: 'HTTP_SERVER_ERROR',
  rateLimited: 'HTTP_RATE_LIMITED',
  clientError: 'HTTP_CLIENT_ERROR',
  redirectNotAllowed: 'HTTP_REDIRECT_NOT_ALLOWED',
} as const;

/** The messages never carry the URL, the headers or the body of the response (research R11). */
const MESSAGES = {
  disabled: 'Las peticiones HTTP están desactivadas.',
  circuitOpen: 'El destino está fallando y el circuito está abierto.',
  circuitUnavailable: 'No se pudo consultar el estado del circuito del destino.',
  serverError: 'El destino respondió con un error del servidor.',
  rateLimited: 'El destino limitó las peticiones.',
  clientError: 'El destino rechazó la petición.',
  redirectNotAllowed: 'La redirección del destino no está permitida.',
} as const;

const EFFECT_METHODS = new Set<string>(['POST', 'PUT', 'PATCH', 'DELETE']);
/** How long to wait before asking Valkey again when the breaker store is down. */
const STORE_RETRY_MS = 5_000;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

/** `Retry-After` in seconds or as an HTTP date, in milliseconds; undefined when it is not usable. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(text);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(0, date - now), MAX_RETRY_AFTER_MS);
}

/** Turns an answer or an error of the client into the outcome the breaker understands. */
function outcomeOf(result: GuardedResponse | ConnectorError): CallOutcome {
  if (result instanceof ConnectorError) {
    return { kind: 'error', code: result.code, errorClass: result.errorClass };
  }
  return { kind: 'response', status: result.status };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new NodeFailure({
      errorClass: 'permanent',
      code: 'HTTP_URL_INVALID',
      message: 'La URL del nodo no es válida.',
    });
  }
}

/**
 * The `http.request` node (F7, research R9-R12). Under the policy of the node it takes a token of
 * the rate limit, resolves the credential and the allowlist, asks the circuit breaker of the
 * organization and host for permission, and only then calls the destination through the guarded
 * client of `@cognitive-dag/connectors`: addresses validated, redirects revalidated, response
 * bounded. Methods with an effect send `Idempotency-Key: <runId>:<nodeId>` in every attempt and are
 * recorded in `node_effects`.
 */
export function createHttpActivities(options: HttpActivityOptions): HttpActivities {
  const random = options.random ?? Math.random;

  return {
    async httpRequest(input) {
      const context = Context.current();
      const log = options.logger.child({
        correlationId: input.correlationId,
        runId: input.runId,
        nodeId: input.nodeId,
      });
      const { config, organizationId } = input;

      if (!options.enabled) {
        throw toApplicationFailure(
          new NodeFailure({
            errorClass: 'permanent',
            code: HTTP_ERROR_CODES.disabled,
            message: MESSAGES.disabled,
          }),
          { attempt: 0, nonRetryable: true },
        );
      }

      const markWaiting = async (
        waitingReason: HttpWaitingMark['waitingReason'],
      ): Promise<void> => {
        if (!options.markWaiting) return;
        try {
          await options.markWaiting({
            organizationId,
            runId: input.runId,
            correlationId: input.correlationId,
            nodeId: input.nodeId,
            waitingReason,
          });
        } catch (error) {
          log.warn({ err: error }, 'Could not mark the step as waiting');
        }
      };

      // Filled by the gate, used by the body: what the gate learns about the destination.
      let host = '';
      let probe = false;
      let credentialHeader: CredentialHeader | undefined;
      let allowlist: string[] = [];

      const gate = async ({ waiting }: { waiting: boolean }): Promise<void> => {
        host = hostOf(config.url);

        if (options.rateLimiter) {
          let decision;
          try {
            decision = await options.rateLimiter.acquire(organizationId, 'http.request');
          } catch (error) {
            log.warn({ err: error }, 'The rate limit store is not available');
            throw new NodeFailure({
              errorClass: 'transient',
              code: 'RATE_LIMIT_UNAVAILABLE',
              message: 'The rate limit store is not available.',
            });
          }
          if (!decision.granted) {
            await markWaiting('rate_limited');
            throw new NodeFailure({
              errorClass: 'rate_limited',
              code: ERROR_CLASS_CODES.rate_limited,
              message: 'The node is waiting for its turn under the rate limit.',
              retryAfterMs: decision.retryAfterMs,
            });
          }
        }

        credentialHeader = config.credentialId
          ? await options.credentials.headerFor(organizationId, config.credentialId)
          : undefined;
        allowlist = await options.credentials.allowlistFor(organizationId);

        // Closed fails closed: if Valkey does not answer, the destination is not called (R12).
        const waitedMs = Date.now() - context.info.scheduledTimestampMs;
        const exhausted = waitedMs >= options.breakerMaxWaitMs;
        let decision;
        try {
          decision = await options.breaker.acquire(organizationId, host);
        } catch (error) {
          log.warn({ err: error }, 'The circuit breaker store is not available');
          if (exhausted) {
            throw new NodeFailure({
              errorClass: 'transient',
              code: HTTP_ERROR_CODES.circuitUnavailable,
              message: MESSAGES.circuitUnavailable,
            });
          }
          await markWaiting('circuit_open');
          throw new NodeFailure({
            errorClass: 'rate_limited',
            code: HTTP_ERROR_CODES.circuitUnavailable,
            message: MESSAGES.circuitUnavailable,
            retryAfterMs: STORE_RETRY_MS,
          });
        }
        if (!decision.allowed) {
          if (exhausted) {
            throw new NodeFailure({
              errorClass: 'transient',
              code: HTTP_ERROR_CODES.circuitOpen,
              message: MESSAGES.circuitOpen,
            });
          }
          log.info(
            { event: 'circuit.waiting', retryAfterMs: decision.retryAfterMs },
            'Circuit open',
          );
          await markWaiting('circuit_open');
          throw new NodeFailure({
            errorClass: 'rate_limited',
            code: HTTP_ERROR_CODES.circuitOpen,
            message: MESSAGES.circuitOpen,
            retryAfterMs: decision.retryAfterMs,
          });
        }
        probe = decision.probe;
        if (waiting) await markWaiting(null);
      };

      /** Calls the destination once and reports the outcome to the breaker. */
      const callDestination = async (key: string | undefined): Promise<GuardedResponse> => {
        let result: GuardedResponse | ConnectorError;
        try {
          result = await guardedRequest({
            url: config.url,
            method: config.method,
            headers: config.headers,
            ...(config.body === '' ? {} : { body: config.body }),
            ...(credentialHeader ? { credentialHeader } : {}),
            ...(key === undefined ? {} : { idempotencyKey: key }),
            ...(allowlist.length > 0 ? { allowlist } : {}),
            ...(options.allowLoopback ? { allowLoopback: true } : {}),
            ...(options.resolve ? { resolve: options.resolve } : {}),
            ...(options.tls ? { tls: options.tls } : {}),
            totalTimeoutMs: input.policy.timeoutSeconds * 1000,
          });
        } catch (error) {
          if (!(error instanceof ConnectorError)) throw error;
          if (error.code === 'SSRF_BLOCKED_ADDRESS') {
            // Without the resolved address: it is the blocked thing (research R15).
            log.warn({ event: 'ssrf.blocked' }, 'Destination blocked');
          }
          await reportToBreaker(error);
          throw error;
        }
        await reportToBreaker(result);
        return result;
      };

      const reportToBreaker = async (result: GuardedResponse | ConnectorError): Promise<void> => {
        const outcome = outcomeOf(result);
        try {
          if (countsAsBreakerFailure(outcome)) {
            const { opened } = await options.breaker.failure(organizationId, host, probe);
            if (opened) {
              log.warn({ event: 'circuit.opened', host, organizationId }, 'Circuit opened');
            }
          } else if (!(result instanceof ConnectorError)) {
            // An answer, even a 4xx, shows the destination is up: it closes a half-open circuit.
            const { closed } = await options.breaker.success(organizationId, host, probe);
            if (closed) {
              const name: WorkerSecurityEvent = 'circuit.closed';
              log.info({ event: name, host, organizationId }, 'Circuit closed');
            }
          }
        } catch (error) {
          // The call already happened; a lost report only delays the breaker.
          log.warn({ err: error }, 'Could not report the outcome to the circuit breaker');
        }
      };

      const attempt = async (executed: number): Promise<HttpRequestResult> => {
        log.info({ attempt: executed }, 'HTTP request started');
        const hasEffect = EFFECT_METHODS.has(config.method);
        const ref = { organizationId, runId: input.runId, nodeId: input.nodeId };
        const storeUnavailable = (error: unknown): never => {
          log.warn({ err: error }, 'The effect store is not available');
          throw new NodeFailure({
            errorClass: 'transient',
            code: 'EFFECT_STORE_UNAVAILABLE',
            message: 'The effect store is not available.',
          });
        };
        if (hasEffect && options.effects) await options.effects.begin(ref).catch(storeUnavailable);

        let response: GuardedResponse;
        try {
          response = await callDestination(
            hasEffect ? idempotencyKeyFor(input.runId, input.nodeId) : undefined,
          );
        } catch (error) {
          if (error instanceof ConnectorError) {
            throw new NodeFailure({
              errorClass: error.errorClass,
              code: error.code,
              message: error.message,
            });
          }
          throw error;
        }

        const { status } = response;
        if (status >= 200 && status < 300) {
          if (hasEffect && options.effects) {
            await options.effects.commit(ref).catch(storeUnavailable);
          }
          log.info({ attempt: executed, status }, 'HTTP request finished');
          return { output: { status, body: response.body }, attempts: executed };
        }
        if (status === 429) {
          throw new NodeFailure({
            errorClass: 'rate_limited',
            code: HTTP_ERROR_CODES.rateLimited,
            message: MESSAGES.rateLimited,
            retryAfterMs:
              parseRetryAfter(response.headers['retry-after']) ?? input.policy.initialIntervalMs,
          });
        }
        if (status >= 500) {
          throw new NodeFailure({
            errorClass: 'transient',
            code: HTTP_ERROR_CODES.serverError,
            message: MESSAGES.serverError,
          });
        }
        if (status >= 300 && status < 400) {
          throw new NodeFailure({
            errorClass: 'permanent',
            code: HTTP_ERROR_CODES.redirectNotAllowed,
            message: MESSAGES.redirectNotAllowed,
          });
        }
        // The rest of the 4xx, 408 included, will not change by repeating the call.
        throw new NodeFailure({
          errorClass: 'permanent',
          code: HTTP_ERROR_CODES.clientError,
          message: MESSAGES.clientError,
        });
      };

      return runWithPolicy({
        policy: input.policy,
        gate,
        body: ({ executed }) => attempt(executed),
        random,
      });
    },
  };
}

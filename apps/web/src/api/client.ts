import {
  CORRELATION_ID_HEADER,
  CSRF_HEADER,
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsSchema,
  type ProblemDetails,
} from '@cognitive-dag/contracts';
import type { z } from 'zod';

const API_URL = import.meta.env.VITE_API_URL as string;

/** Error carrying an RFC 9457 problem returned by the API. */
export class ApiProblemError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail);
    this.name = 'ApiProblemError';
  }
}

/** The CSRF token of the current session; the session query keeps it up to date. */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Reactions the app registers for responses that mean the session or the organization is gone. */
export interface ApiEventHandlers {
  /** 401 UNAUTHENTICATED on any call except the one that asks whether there is a session. */
  onUnauthenticated?: () => void;
  /** 404 NOT_FOUND under /organizations/{id}: the user lost that organization. */
  onOrganizationLost?: (organizationId: string) => void;
}

let handlers: ApiEventHandlers = {};

export function setApiEventHandlers(next: ApiEventHandlers): void {
  handlers = next;
}

const SESSION_PATH = '/api/v1/auth/session';
const ORGANIZATION_PATH = /^\/api\/v1\/organizations\/([0-9a-f-]{36})\//;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface ApiResponse<T> {
  data: T;
  correlationId: string | null;
}

/**
 * Typed request: every call sends its own correlation id and validates the response against
 * the shared contract, so the web never trusts an unexpected shape.
 */
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  headers.set(CORRELATION_ID_HEADER, crypto.randomUUID());
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (csrfToken !== null && !SAFE_METHODS.has((init.method ?? 'GET').toUpperCase())) {
    headers.set(CSRF_HEADER, csrfToken);
  }

  // The session lives in an HttpOnly cookie that has to travel with every call.
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  const correlationId = response.headers.get(CORRELATION_ID_HEADER);
  // 204 answers carry no body.
  const body: unknown = response.status === 204 ? undefined : await response.json();

  if (!response.ok) {
    const contentType = response.headers.get('Content-Type') ?? '';
    const problem = ProblemDetailsSchema.safeParse(body);
    if (contentType.startsWith(PROBLEM_CONTENT_TYPE) && problem.success) {
      notify(path, problem.data);
      throw new ApiProblemError(problem.data);
    }
    throw new Error(`Unexpected response ${response.status}`);
  }

  return { data: schema.parse(body), correlationId };
}

function notify(path: string, problem: ProblemDetails): void {
  if (problem.code === 'UNAUTHENTICATED' && path !== SESSION_PATH) {
    handlers.onUnauthenticated?.();
  }
  if (problem.code === 'NOT_FOUND') {
    const organizationId = ORGANIZATION_PATH.exec(path)?.[1];
    if (organizationId !== undefined) handlers.onOrganizationLost?.(organizationId);
  }
}

import {
  CORRELATION_ID_HEADER,
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

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const correlationId = response.headers.get(CORRELATION_ID_HEADER);
  // 204 answers carry no body.
  const body: unknown = response.status === 204 ? undefined : await response.json();

  if (!response.ok) {
    const contentType = response.headers.get('Content-Type') ?? '';
    const problem = ProblemDetailsSchema.safeParse(body);
    if (contentType.startsWith(PROBLEM_CONTENT_TYPE) && problem.success) {
      throw new ApiProblemError(problem.data);
    }
    throw new Error(`Unexpected response ${response.status}`);
  }

  return { data: schema.parse(body), correlationId };
}

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CORRELATION_ID_HEADER,
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsSchema,
  type ProblemDetails,
} from '@cognitive-dag/contracts';
import type { AppConfig } from '../../src/config/env.schema';
import { httpServer } from './helpers';
import { setupOrgPing, type OrgPingEnv } from './org-ping-helpers';

function expectProblem(
  response: request.Response,
  status: number,
  code: string,
  correlationId: string,
): ProblemDetails {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  expect(response.headers['x-correlation-id']).toBe(correlationId);
  const problem = ProblemDetailsSchema.parse(response.body);
  expect(problem.code).toBe(code);
  expect(problem.correlationId).toBe(correlationId);
  expect(response.body).not.toHaveProperty('type');
  expect(response.body).not.toHaveProperty('instance');
  return problem;
}

/** Only one Nest app may be alive at a time: apps in one process share nestjs-cls state. */
function withApp(
  name: string,
  overrides: Partial<AppConfig>,
  tests: (env: () => OrgPingEnv) => void,
): void {
  describe(`problem details: ${name} (requires docker compose up)`, () => {
    let env: OrgPingEnv;
    beforeAll(async () => {
      env = await setupOrgPing({ ...overrides });
    });
    afterAll(async () => {
      await env.close();
    });
    tests(() => env);
  });
}

const correlationId = randomUUID();
const post = (env: OrgPingEnv) => env.post().set(CORRELATION_ID_HEADER, correlationId);

withApp('validation and routing', {}, (env) => {
  it('returns 422 with field errors for an invalid body', async () => {
    const problem = expectProblem(
      await post(env()).send({ message: 42 }),
      422,
      'VALIDATION_FAILED',
      correlationId,
    );
    expect(problem.errors?.[0]?.field).toBe('message');
  });

  it('returns 422 for malformed JSON', async () => {
    const response = await post(env()).set('Content-Type', 'application/json').send('{"message":');
    expectProblem(response, 422, 'VALIDATION_FAILED', correlationId);
  });

  it('returns 404 ROUTE_NOT_FOUND for an unknown route', async () => {
    const response = await request(httpServer(env().app))
      .get('/api/v1/nope')
      .set(CORRELATION_ID_HEADER, correlationId);
    expectProblem(response, 404, 'ROUTE_NOT_FOUND', correlationId);
  });
});

withApp('body limit', { BODY_LIMIT: '1kb' }, (env) => {
  it('returns 413 when the body exceeds the configured limit', async () => {
    const response = await post(env()).send({ message: 'x'.repeat(5_000) });
    expectProblem(response, 413, 'PAYLOAD_TOO_LARGE', correlationId);
  });
});

withApp('Temporal unreachable', { TEMPORAL_ADDRESS: '127.0.0.1:1' }, (env) => {
  it('returns 503 SERVICE_UNAVAILABLE without leaking the address', async () => {
    const response = await post(env()).send({});
    expectProblem(response, 503, 'SERVICE_UNAVAILABLE', correlationId);
    expect(JSON.stringify(response.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|grpc/i);
  });
});

// A namespace that does not exist makes Temporal answer NOT_FOUND: neither a client mistake nor
// an outage, so it must surface as an opaque 500.
withApp('unexpected error', { TEMPORAL_NAMESPACE: `missing-${randomUUID()}` }, (env) => {
  it('returns 500 without stack trace or internal names', async () => {
    const response = await post(env()).send({});
    expectProblem(response, 500, 'INTERNAL_ERROR', correlationId);
    expect(JSON.stringify(response.body)).not.toMatch(
      /\bat\s.+\(|stack|Namespace|Error:|missing-|node_modules|\.ts/,
    );
  });
});

import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CORRELATION_ID_HEADER,
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsSchema,
  type ProblemDetails,
} from '@cognitive-dag/contracts';
import type { AppConfig } from '../../src/config/env.schema';
import { httpServer, startTestApp } from './helpers';

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
  tests: (app: () => INestApplication) => void,
): void {
  describe(`problem details: ${name} (requires docker compose up)`, () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await startTestApp({ FEATURE_FLAGS: '{"ping-enabled":true}', ...overrides });
    });
    afterAll(async () => {
      await app.close();
    });
    tests(() => app);
  });
}

const correlationId = randomUUID();
const post = (app: INestApplication) =>
  request(httpServer(app)).post('/api/v1/pings').set(CORRELATION_ID_HEADER, correlationId);

withApp('validation and routing', {}, (app) => {
  it('returns 422 with field errors for an invalid body', async () => {
    const problem = expectProblem(
      await post(app()).send({ message: 42 }),
      422,
      'VALIDATION_FAILED',
      correlationId,
    );
    expect(problem.errors?.[0]?.field).toBe('message');
  });

  it('returns 422 for malformed JSON', async () => {
    const response = await post(app()).set('Content-Type', 'application/json').send('{"message":');
    expectProblem(response, 422, 'VALIDATION_FAILED', correlationId);
  });

  it('returns 404 ROUTE_NOT_FOUND for an unknown route', async () => {
    const response = await request(httpServer(app()))
      .get('/api/v1/nope')
      .set(CORRELATION_ID_HEADER, correlationId);
    expectProblem(response, 404, 'ROUTE_NOT_FOUND', correlationId);
  });
});

withApp('body limit', { BODY_LIMIT: '1kb' }, (app) => {
  it('returns 413 when the body exceeds the configured limit', async () => {
    const response = await post(app()).send({ message: 'x'.repeat(5_000) });
    expectProblem(response, 413, 'PAYLOAD_TOO_LARGE', correlationId);
  });
});

withApp('Temporal unreachable', { TEMPORAL_ADDRESS: '127.0.0.1:1' }, (app) => {
  it('returns 503 SERVICE_UNAVAILABLE without leaking the address', async () => {
    const response = await post(app()).send({});
    expectProblem(response, 503, 'SERVICE_UNAVAILABLE', correlationId);
    expect(JSON.stringify(response.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|grpc/i);
  });
});

// A namespace that does not exist makes Temporal answer NOT_FOUND: neither a client mistake nor
// an outage, so it must surface as an opaque 500.
withApp('unexpected error', { TEMPORAL_NAMESPACE: `missing-${randomUUID()}` }, (app) => {
  it('returns 500 without stack trace or internal names', async () => {
    const response = await post(app()).send({});
    expectProblem(response, 500, 'INTERNAL_ERROR', correlationId);
    expect(JSON.stringify(response.body)).not.toMatch(
      /\bat\s.+\(|stack|Namespace|Error:|missing-|node_modules|\.ts/,
    );
  });
});

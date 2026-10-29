import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORRELATION_ID_HEADER, ProblemDetailsSchema } from '@cognitive-dag/contracts';
import { httpServer, startTestApp } from './helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('correlation id (requires docker compose up)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const unknownRoute = (header?: string) => {
    const call = request(httpServer(app)).get('/api/v1/does-not-exist');
    return (header === undefined ? call : call.set(CORRELATION_ID_HEADER, header)).expect(404);
  };

  it('generates a new UUID when the header is missing', async () => {
    const response = await unknownRoute();
    const id = response.headers['x-correlation-id'] as string;
    expect(id).toMatch(UUID);
    expect(ProblemDetailsSchema.parse(response.body).correlationId).toBe(id);
  });

  it('reuses a valid incoming UUID in the header and the problem body', async () => {
    const incoming = randomUUID();
    const response = await unknownRoute(incoming);
    expect(response.headers['x-correlation-id']).toBe(incoming);
    expect(ProblemDetailsSchema.parse(response.body).correlationId).toBe(incoming);
  });

  it.each([
    ['not a UUID', 'not-a-uuid'],
    ['longer than 36 characters', `${randomUUID()}-extra`],
    ['containing control characters', `${randomUUID()}\t`],
  ])('replaces a value that is %s', async (_label, bad) => {
    const response = await unknownRoute(bad);
    const id = response.headers['x-correlation-id'] as string;
    expect(id).toMatch(UUID);
    expect(id).not.toBe(bad);
    expect(ProblemDetailsSchema.parse(response.body).correlationId).toBe(id);
  });

  it('echoes the id on successful and health responses', async () => {
    const incoming = randomUUID();
    const live = await request(httpServer(app))
      .get('/health/live')
      .set(CORRELATION_ID_HEADER, incoming)
      .expect(200);
    expect(live.headers['x-correlation-id']).toBe(incoming);

    const ready = await request(httpServer(app))
      .get('/health/ready')
      .set(CORRELATION_ID_HEADER, incoming);
    expect(ready.headers['x-correlation-id']).toBe(incoming);
  });
});

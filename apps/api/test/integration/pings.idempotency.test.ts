import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PingExecutionSchema } from '@cognitive-dag/contracts';
import { httpServer } from './helpers';
import { startPingApi, uniqueTaskQueue } from './ping-helpers';

describe('ping idempotency (requires docker compose up)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startPingApi(uniqueTaskQueue());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the same pingId for the same Idempotency-Key', async () => {
    const key = randomUUID();
    const first = await request(httpServer(app))
      .post('/api/v1/pings')
      .set('Idempotency-Key', key)
      .expect(202);
    const second = await request(httpServer(app))
      .post('/api/v1/pings')
      .set('Idempotency-Key', key)
      .expect(202);

    const firstPing = PingExecutionSchema.parse(first.body);
    expect(firstPing.pingId).toBe(`ping-${key}`);
    expect(PingExecutionSchema.parse(second.body).pingId).toBe(firstPing.pingId);
    expect(second.headers['location']).toBe(first.headers['location']);
  });

  it('creates distinct pings when no key is sent', async () => {
    const a = await request(httpServer(app)).post('/api/v1/pings').expect(202);
    const b = await request(httpServer(app)).post('/api/v1/pings').expect(202);
    expect(PingExecutionSchema.parse(a.body).pingId).not.toBe(
      PingExecutionSchema.parse(b.body).pingId,
    );
  });
});

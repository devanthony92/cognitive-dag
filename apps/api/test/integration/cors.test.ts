import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpServer, startTestApp, testConfig } from './helpers';

describe('CORS (requires docker compose up)', () => {
  let app: INestApplication;
  const origin = testConfig().WEB_ORIGIN;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes the headers the web app reads, Retry-After included', async () => {
    const response = await request(httpServer(app))
      .get('/api/v1/does-not-exist')
      .set('Origin', origin);
    const exposed = String(response.headers['access-control-expose-headers'] ?? '')
      .split(',')
      .map((header) => header.trim().toLowerCase());
    expect(exposed).toEqual(
      expect.arrayContaining(['x-correlation-id', 'location', 'etag', 'retry-after']),
    );
  });
});

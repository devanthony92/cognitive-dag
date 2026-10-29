import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpServer, startTestApp } from './helpers';

const WEB_ORIGIN = 'http://localhost:5173';

describe('security headers and CORS (requires docker compose up)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp({ WEB_ORIGIN });
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets Helmet headers and does not advertise the framework', async () => {
    const response = await request(httpServer(app)).get('/health/live').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows the configured web origin', async () => {
    const response = await request(httpServer(app))
      .get('/health/live')
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });

  it('does not grant CORS to another origin', async () => {
    const response = await request(httpServer(app))
      .get('/health/live')
      .set('Origin', 'http://evil.example')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).not.toBe('http://evil.example');
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });
});

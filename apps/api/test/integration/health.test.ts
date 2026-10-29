import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthReportSchema } from '@cognitive-dag/contracts';
import { httpServer, startTestApp } from './helpers';

describe('API health (requires docker compose up)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness', async () => {
    const response = await request(httpServer(app)).get('/health/live').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports every dependency up when the infrastructure is running', async () => {
    const response = await request(httpServer(app)).get('/health/ready').expect(200);
    expect(HealthReportSchema.parse(response.body)).toEqual({
      status: 'ok',
      checks: {
        postgres: { status: 'up' },
        valkey: { status: 'up' },
        temporal: { status: 'up' },
      },
    });
  });

  it('reports a dependency down without exposing internal errors', async () => {
    const broken = await startTestApp({ TEMPORAL_ADDRESS: '127.0.0.1:1' });
    try {
      const response = await request(httpServer(broken)).get('/health/ready').expect(503);
      const report = HealthReportSchema.parse(response.body);
      expect(report.status).toBe('error');
      expect(report.checks?.temporal).toEqual({ status: 'down' });
      expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED|message|stack|127.0.0.1/);
    } finally {
      await broken.close();
    }
  });
});

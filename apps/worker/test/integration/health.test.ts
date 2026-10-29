import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthReportSchema } from '@cognitive-dag/contracts';
import { startHealthServer } from '../../src/health/server';

describe('worker health server (contracts/worker-health.md)', () => {
  let server: Server;
  let ready = false;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startHealthServer(0, () => ready);
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No port assigned');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('reports liveness', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports not ready until the worker is running', async () => {
    ready = false;
    const notReady = await fetch(`${baseUrl}/health/ready`);
    expect(notReady.status).toBe(503);
    expect(HealthReportSchema.parse(await notReady.json()).checks).toEqual({
      'temporal-worker': { status: 'down' },
    });

    ready = true;
    const isReady = await fetch(`${baseUrl}/health/ready`);
    expect(isReady.status).toBe(200);
    expect(await isReady.json()).toEqual({
      status: 'ok',
      checks: { 'temporal-worker': { status: 'up' } },
    });
  });

  it('responds 404 without body to any other route', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });
});

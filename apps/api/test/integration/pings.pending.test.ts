import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PingExecutionSchema } from '@cognitive-dag/contracts';
import { httpServer } from './helpers';
import { startPingApi, startPingWorker, uniqueTaskQueue, waitFor } from './ping-helpers';

describe('ping pending status (requires docker compose up)', () => {
  const taskQueue = uniqueTaskQueue();
  let app: INestApplication;

  beforeAll(async () => {
    app = await startPingApi(taskQueue);
  });

  afterAll(async () => {
    await app.close();
  });

  it('is pending while no worker serves the task queue, then completes once one starts', async () => {
    const created = await request(httpServer(app)).post('/api/v1/pings').expect(202);
    const ping = PingExecutionSchema.parse(created.body);
    expect(ping.status).toBe('pending');

    const read = await request(httpServer(app)).get(`/api/v1/pings/${ping.pingId}`).expect(200);
    expect(PingExecutionSchema.parse(read.body).status).toBe('pending');

    const worker = await startPingWorker(taskQueue);
    try {
      const completed = await waitFor(async () => {
        const response = await request(httpServer(app))
          .get(`/api/v1/pings/${ping.pingId}`)
          .expect(200);
        const current = PingExecutionSchema.parse(response.body);
        return current.status === 'completed' ? current : undefined;
      });
      expect(completed.result?.attempts).toBe(1);
    } finally {
      await worker.stop();
    }
  });
});

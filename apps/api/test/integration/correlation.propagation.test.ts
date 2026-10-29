import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { SearchAttributeType, defineSearchAttributeKey } from '@temporalio/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  PingExecutionSchema,
} from '@cognitive-dag/contracts';
import { createLogger } from '@cognitive-dag/logger';
import { httpServer, testConfig } from './helpers';
import { startPingApi, startPingWorker, uniqueTaskQueue, waitFor } from './ping-helpers';

describe('correlation propagation API to worker (requires docker compose up)', () => {
  const taskQueue = uniqueTaskQueue();
  const lines: string[] = [];
  let app: INestApplication;
  let connection: Connection;
  let client: Client;

  beforeAll(async () => {
    app = await startPingApi(taskQueue);
    const config = testConfig();
    connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
    client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
  });

  afterAll(async () => {
    await connection.close();
    await app.close();
  });

  it('carries the POST correlation id into the search attribute and the worker logs', async () => {
    const correlationId = randomUUID();
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    const logger = createLogger({ component: 'worker', level: 'info' }, sink);
    const worker = await startPingWorker(taskQueue, { logger });
    try {
      const created = await request(httpServer(app))
        .post('/api/v1/pings')
        .set(CORRELATION_ID_HEADER, correlationId)
        .send({})
        .expect(202);
      expect(created.headers['x-correlation-id']).toBe(correlationId);
      const ping = PingExecutionSchema.parse(created.body);
      expect(ping.correlationId).toBe(correlationId);

      await waitFor(async () => {
        const response = await request(httpServer(app)).get(`/api/v1/pings/${ping.pingId}`);
        return PingExecutionSchema.parse(response.body).status === 'completed' ? true : undefined;
      });

      const description = await client.workflow.getHandle(ping.pingId).describe();
      const key = defineSearchAttributeKey(
        CORRELATION_ID_SEARCH_ATTRIBUTE,
        SearchAttributeType.KEYWORD,
      );
      expect(description.typedSearchAttributes.get(key)).toBe(correlationId);

      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const activityLogs = entries.filter(
        (entry) => entry.correlationId === correlationId && entry.component === 'worker',
      );
      expect(activityLogs.map((entry) => entry.msg)).toEqual([
        'Ping activity started',
        'Ping activity finished',
      ]);
    } finally {
      await worker.stop();
    }
  });
});

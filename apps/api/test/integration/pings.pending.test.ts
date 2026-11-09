import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PingExecutionSchema } from '@cognitive-dag/contracts';
import { setupOrgPing, type OrgPingEnv } from './org-ping-helpers';
import { startPingWorker, uniqueTaskQueue, waitFor } from './ping-helpers';

describe('ping pending status (requires docker compose up)', () => {
  const taskQueue = uniqueTaskQueue();
  let env: OrgPingEnv;

  beforeAll(async () => {
    env = await setupOrgPing({ TEMPORAL_TASK_QUEUE: taskQueue });
  });

  afterAll(async () => {
    await env.close();
  });

  it('is pending while no worker serves the task queue, then completes once one starts', async () => {
    const created = await env.post().expect(202);
    const ping = PingExecutionSchema.parse(created.body);
    expect(ping.status).toBe('pending');

    const read = await env.get(ping.pingId).expect(200);
    expect(PingExecutionSchema.parse(read.body).status).toBe('pending');

    const worker = await startPingWorker(taskQueue);
    try {
      const completed = await waitFor(async () => {
        const response = await env.get(ping.pingId).expect(200);
        const current = PingExecutionSchema.parse(response.body);
        return current.status === 'completed' ? current : undefined;
      });
      expect(completed.result?.attempts).toBe(1);
    } finally {
      await worker.stop();
    }
  });
});

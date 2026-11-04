import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definition, edge, mock, trigger } from '../helpers/dags';
import { readRun } from '../integration/support/seed';
import {
  expectNoRepeatedEffects,
  openHarness,
  resultOf,
  spawnWorker,
  startRun,
  startWorker,
  waitUntil,
  type Harness,
} from './support/harness';

describe('chaos: worker killed mid-node (requires docker compose up)', () => {
  const taskQueue = `chaos-${randomUUID()}`;
  let h: Harness;

  beforeAll(async () => {
    h = await openHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  it('finishes the run after SIGKILL without repeating the nodes or their effects', async () => {
    // trigger -> a (instant) -> b (slow: the worker dies here) -> c (instant)
    const dag = definition(
      [trigger(), mock('a'), mock('b', { latencyMs: 6_000 }), mock('c')],
      [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'c')],
    );
    const child = spawnWorker(h, taskQueue, 'worker-crashed');
    let second: { stop(): Promise<void> } | undefined;
    try {
      const { seeded, handle } = await startRun(h, taskQueue, dag);

      // Wait until `a` is recorded as done and `b` runs in the child, then kill it without cleanup.
      await waitUntil(
        async () => {
          const { raw } = await handle.describe();
          const running = raw.pendingActivities?.some((activity) => activity.lastStartedTime);
          const steps = (await readRun(h.pool, seeded)).steps;
          const a = steps.find((s) => s.node_id === 'a')?.status;
          const b = steps.find((s) => s.node_id === 'b')?.status;
          return Boolean(running) && a === 'succeeded' && b === 'running';
        },
        'node b to start in the child worker',
        40_000,
      );
      await child.kill();

      second = await startWorker(h, taskQueue, 'worker-b');
      const result = await resultOf(handle);
      expect(result.status).toBe('succeeded');

      // Each node ran once as far as the history is concerned: a and c are not repeated and b,
      // interrupted by the kill, was retried by Temporal, not rescheduled by the interpreter.
      const history = await handle.fetchHistory();
      const events = history.events ?? [];
      const mockScheduled = events.filter(
        (e) => e.activityTaskScheduledEventAttributes?.activityType?.name === 'mockService',
      );
      expect(mockScheduled).toHaveLength(3);
      const completedIds = new Set(
        events
          .filter((e) => e.activityTaskCompletedEventAttributes)
          .map((e) => String(e.activityTaskCompletedEventAttributes?.scheduledEventId)),
      );
      for (const event of mockScheduled) expect(completedIds.has(String(event.eventId))).toBe(true);

      const state = await readRun(h.pool, seeded);
      const byNode = Object.fromEntries(state.steps.map((s) => [s.node_id, s]));
      expect(byNode['a']?.attempts).toBe(1);
      expect(byNode['c']?.attempts).toBe(1);
      // The attempt interrupted by the kill counts: b finished on its second attempt.
      expect(byNode['b']?.attempts).toBeGreaterThanOrEqual(2);

      await expectNoRepeatedEffects(h, seeded, ['a', 'b', 'c']);
    } finally {
      await child.kill();
      await second?.stop();
    }
  }, 120_000);
});

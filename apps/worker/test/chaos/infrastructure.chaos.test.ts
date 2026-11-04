import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definition, edge, mock, trigger } from '../helpers/dags';
import {
  ensureRunning,
  expectNoRepeatedEffects,
  openHarness,
  pauseFor,
  restart,
  resultOf,
  startRun,
  startWorker,
  stepStatus,
  waitUntil,
  type Harness,
  type Service,
} from './support/harness';

/** trigger -> a -> b -> c, each step slow enough for the fault to land in the middle of the run. */
const chain = () =>
  definition(
    [
      trigger(),
      mock('a', { latencyMs: 1_500 }),
      mock('b', { latencyMs: 4_000 }),
      mock('c', { latencyMs: 1_500 }),
    ],
    [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'c')],
  );

describe('chaos: infrastructure faults during a run (requires docker compose up)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await openHarness();
  });

  afterAll(async () => {
    // Whatever happened, the containers must be left running for the next test and for the user.
    const services: Service[] = ['temporal', 'valkey', 'postgres'];
    await Promise.allSettled(services.map((service) => ensureRunning(service)));
    await h.close();
  });

  /** Starts the chain, injects `fault` once node `b` is running, and checks the outcome. */
  async function runWithFault(fault: () => Promise<void>): Promise<void> {
    const taskQueue = `chaos-${randomUUID()}`;
    const worker = await startWorker(h, taskQueue, 'worker-chaos');
    try {
      const { seeded, handle } = await startRun(h, taskQueue, chain());
      await waitUntil(
        async () => (await stepStatus(h, seeded, 'b')) === 'running',
        'node b to start',
      );
      await fault();
      const result = await resultOf(handle);
      expect(result.status).toBe('succeeded');
      await expectNoRepeatedEffects(h, seeded, ['a', 'b', 'c']);
    } finally {
      await worker.stop();
    }
  }

  it('finishes the run after the Temporal container restarts', async () => {
    await runWithFault(() => restart('temporal'));
  }, 180_000);

  it('finishes the run after Valkey is paused for a few seconds', async () => {
    await runWithFault(() => pauseFor('valkey', 6_000));
  }, 120_000);

  it('finishes the run after PostgreSQL is paused for a few seconds', async () => {
    await runWithFault(() => pauseFor('postgres', 6_000));
  }, 120_000);
});

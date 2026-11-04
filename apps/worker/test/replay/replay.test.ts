import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@cognitive-dag/logger';
import { EXECUTE_DAG_WORKFLOW_NAME, type ExecuteDagInput } from '@cognitive-dag/contracts';
import { createMockServiceActivities } from '../../src/activities/mock-service';
import type { EffectDestination, EffectStore } from '../../src/resilience/effects';
import type { RateLimiter } from '../../src/resilience/rate-limiter';
import { condition, definition, edge, merge, mock, trigger } from '../helpers/dags';

const workflowsPath = path.resolve(__dirname, '../../src/workflows');
const historiesDir = path.resolve(__dirname, 'histories');
const logger = createLogger({ component: 'worker-test', level: 'silent' });

/** Stored histories: the F3 ones were recorded before F4 and must keep replaying (`patched`). */
const F3 = ['f3-diamond', 'f3-fail-fast', 'f3-merge-any'];

interface Scenario {
  dag: ReturnType<typeof definition>;
  /** Outputs of nodes a rerun from a node does not run again. */
  memoized?: Record<string, unknown>;
  /** Limits the node `limited` for the first N requests, as the token bucket would. */
  denyFirst?: number;
  /** Cancels the run once the node is running. */
  cancelWhenRunning?: string;
}

/**
 * F4 scenarios. When the interpreter changes in a way that breaks the replay of these histories,
 * the change needs `patched()` (research R1): never just regenerate them. To record them again on
 * purpose: `RECORD_HISTORIES=1 pnpm --filter @cognitive-dag/worker test:integration`.
 */
const scenarios: Record<string, Scenario> = {
  // three parallel branches that start together and join
  'f4-parallel': {
    dag: definition(
      [
        trigger(),
        mock('a', { latencyMs: 150 }),
        mock('b', { latencyMs: 150 }),
        mock('c', { latencyMs: 150 }),
        merge('join', 'all'),
        mock('after'),
      ],
      [
        edge('trigger', 'a'),
        edge('trigger', 'b'),
        edge('trigger', 'c'),
        edge('a', 'join'),
        edge('b', 'join'),
        edge('c', 'join'),
        edge('join', 'after'),
      ],
    ),
  },
  // the condition is false: `big` is skipped and `small` runs
  'f4-skipped-branch': {
    dag: definition(
      [trigger(), condition('check', 1_000), mock('big'), mock('small'), merge('join', 'any')],
      [
        edge('trigger', 'check'),
        edge('check', 'big', 'true'),
        edge('check', 'small', 'false'),
        edge('big', 'join'),
        edge('small', 'join'),
      ],
    ),
  },
  // a permanent failure: one attempt, no retries, the run fails
  'f4-failure': {
    dag: definition(
      [trigger(), mock('ok'), mock('bad', { failureKind: 'permanent', failureRate: 1 })],
      [edge('trigger', 'ok'), edge('ok', 'bad')],
    ),
  },
  // a transient failure that recovers on the third attempt, under the retry of the node
  'f4-retry': {
    dag: definition(
      [trigger(), mock('flaky', { failureKind: 'transient', failFirstAttempts: 2 })],
      [edge('trigger', 'flaky')],
    ),
  },
  // the run is cancelled while a node is running
  'f4-cancelled': {
    dag: definition(
      [trigger(), mock('slow', { latencyMs: 20_000 }), mock('never')],
      [edge('trigger', 'slow'), edge('slow', 'never')],
    ),
    cancelWhenRunning: 'slow',
  },
  // the token bucket denies the first requests: the node waits for its turn and then runs
  'f4-rate-limited': {
    dag: definition([trigger(), mock('limited')], [edge('trigger', 'limited')]),
    denyFirst: 2,
  },
  // rerun from `c`: `a` and `b` are reused with the output of the original run
  'f4-reused': {
    dag: definition(
      [trigger(), mock('a'), mock('b'), mock('c')],
      [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'c')],
    ),
    memoized: { trigger: { amount: 150, tone: 'happy' }, a: { ok: true }, b: { ok: true } },
  },
};

/** In-memory stand-ins for Postgres and Valkey: the history records what the workflow sees. */
function fakes(denyFirst: number) {
  const committed = new Set<string>();
  const effects: EffectStore = {
    begin: (ref) => {
      const state = committed.has(ref.nodeId) ? 'committed' : 'started';
      return Promise.resolve({ status: state, attempts: 1 });
    },
    commit: (ref) => {
      committed.add(ref.nodeId);
      return Promise.resolve();
    },
  };
  const destination: EffectDestination = { register: () => Promise.resolve(true) };
  let denied = 0;
  const rateLimiter: RateLimiter = {
    acquire: () => {
      if (denied < denyFirst) {
        denied += 1;
        return Promise.resolve({ granted: false, retryAfterMs: 300 });
      }
      return Promise.resolve({ granted: true });
    },
  };
  return { effects, destination, rateLimiter };
}

async function record(env: TestWorkflowEnvironment, name: string): Promise<void> {
  const scenario = scenarios[name] as Scenario;
  const taskQueue = `gen-${randomUUID()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: {
      recordRunEvent: () => Promise.resolve(),
      ...createMockServiceActivities({
        logger,
        ...fakes(scenario.denyFirst ?? 0),
        markWaiting: () => Promise.resolve(),
      }),
    },
  });
  const input: ExecuteDagInput = {
    organizationId: randomUUID(),
    workflowId: randomUUID(),
    versionId: randomUUID(),
    versionNumber: 1,
    runId: randomUUID(),
    correlationId: randomUUID(),
    definition: scenario.dag,
    triggerInput: { amount: 150, tone: 'happy' },
    ...(scenario.memoized ? { memoized: scenario.memoized } : {}),
  };
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start(EXECUTE_DAG_WORKFLOW_NAME, {
      taskQueue,
      workflowId: `run-${input.runId}`,
      args: [input],
    });
    if (scenario.cancelWhenRunning) {
      for (;;) {
        const { raw } = await handle.describe();
        if (raw.pendingActivities?.some((a) => a.lastStartedTime)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await handle.cancel();
    }
    await handle.result().catch(() => undefined);
    const history = await handle.fetchHistory();
    writeFileSync(path.join(historiesDir, `${name}.json`), historyToJSON(history));
  });
}

describe.skipIf(!process.env.RECORD_HISTORIES)('recording of the F4 histories', () => {
  it('records the stored histories', async () => {
    const env = await TestWorkflowEnvironment.createLocal();
    try {
      for (const name of Object.keys(scenarios)) await record(env, name);
    } finally {
      await env.teardown();
    }
  }, 180_000);
});

describe('executeDag replay of the stored histories', () => {
  const files = readdirSync(historiesDir).filter((f) => f.endsWith('.json'));

  it('has a stored history for every scenario', () => {
    expect(files.sort()).toEqual(
      [...F3, ...Object.keys(scenarios)].map((name) => `${name}.json`).sort(),
    );
  });

  it('replays every history without non-determinism errors', async () => {
    const histories = files.map((file) => ({
      workflowId: file.replace(/\.json$/, ''),
      history: JSON.parse(readFileSync(path.join(historiesDir, file), 'utf8')) as unknown,
    }));
    const failures: string[] = [];
    for await (const result of Worker.runReplayHistories({ workflowsPath }, histories)) {
      if (result.error) failures.push(`${result.workflowId}: ${String(result.error)}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});

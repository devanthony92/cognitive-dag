import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ApplicationFailure, Context } from '@temporalio/activity';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';
import { EXECUTE_DAG_WORKFLOW_NAME, type ExecuteDagInput } from '@cognitive-dag/contracts';
import type { MockServiceInput } from '../../src/activities/mock-service';
import { condition, definition, edge, merge, mock, trigger } from '../helpers/dags';

const workflowsPath = path.resolve(__dirname, '../../src/workflows');
const historiesDir = path.resolve(__dirname, '../histories');
const PREFIX = 'execute-dag-';

/**
 * Scenarios whose histories are stored in `test/histories`. When the interpreter changes in a way
 * that breaks replay of these histories, the change needs `patched()` (research R1): never just
 * regenerate them. To record them again on purpose: `RECORD_HISTORIES=1 pnpm test`.
 */
const scenarios: Record<string, ReturnType<typeof definition>> = {
  // parallel branches, a condition with a skipped branch, merge all and a node after the merge
  diamond: definition(
    [
      trigger(),
      condition('check', 100),
      mock('big'),
      mock('small'),
      mock('side'),
      merge('join', 'all'),
      mock('after'),
    ],
    [
      edge('trigger', 'check'),
      edge('trigger', 'side'),
      edge('check', 'big', 'true'),
      edge('check', 'small', 'false'),
      edge('big', 'join'),
      edge('small', 'join'),
      edge('side', 'join'),
      edge('join', 'after'),
    ],
  ),
  // merge any continues on the first branch while the other one is still running
  'merge-any': definition(
    [trigger(), mock('fast'), mock('slow'), merge('join', 'any'), mock('after')],
    [
      edge('trigger', 'fast'),
      edge('trigger', 'slow'),
      edge('fast', 'join'),
      edge('slow', 'join'),
      edge('join', 'after'),
    ],
  ),
  // the first failure cancels the branch that is still running
  'fail-fast': definition(
    [trigger(), mock('bad'), mock('slow'), mock('never')],
    [edge('trigger', 'bad'), edge('trigger', 'slow'), edge('slow', 'never')],
  ),
};

async function record(env: TestWorkflowEnvironment, name: string): Promise<void> {
  const taskQueue = `gen-${randomUUID()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: {
      recordRunEvent: () => Promise.resolve(),
      mockService: async (input: MockServiceInput) => {
        const attempt = Context.current().info.attempt;
        if (input.nodeId === 'bad') {
          throw ApplicationFailure.create({
            type: 'MOCK_SERVICE_PERMANENT',
            message: 'The simulated service failed (permanent).',
            nonRetryable: true,
            details: [{ attempt }],
          });
        }
        await new Promise((resolve) => setTimeout(resolve, input.nodeId === 'slow' ? 800 : 50));
        return { output: { ok: true }, attempts: attempt };
      },
    },
  });
  const input: ExecuteDagInput = {
    organizationId: randomUUID(),
    workflowId: randomUUID(),
    versionId: randomUUID(),
    versionNumber: 1,
    runId: randomUUID(),
    correlationId: randomUUID(),
    definition: scenarios[name] as Record<string, unknown>,
    triggerInput: { amount: 150, tone: 'happy' },
  };
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start(EXECUTE_DAG_WORKFLOW_NAME, {
      taskQueue,
      workflowId: `run-${input.runId}`,
      args: [input],
    });
    await handle.result().catch(() => undefined);
    const history = await handle.fetchHistory();
    writeFileSync(path.join(historiesDir, `${PREFIX}${name}.json`), historyToJSON(history));
  });
}

describe.skipIf(!process.env.RECORD_HISTORIES)('recording of the interpreter histories', () => {
  it('records the stored histories', async () => {
    const env = await TestWorkflowEnvironment.createLocal();
    try {
      for (const name of Object.keys(scenarios)) await record(env, name);
    } finally {
      await env.teardown();
    }
  }, 120_000);
});

describe('executeDag replay', () => {
  const files = readdirSync(historiesDir).filter((f) => f.startsWith(PREFIX));

  it('has a stored history for every scenario', () => {
    expect(files.sort()).toEqual(
      Object.keys(scenarios)
        .map((name) => `${PREFIX}${name}.json`)
        .sort(),
    );
  });

  it.each(Object.keys(scenarios))(
    'replays the recorded %s history without non-determinism errors',
    async (name) => {
      const history: unknown = JSON.parse(
        readFileSync(path.join(historiesDir, `${PREFIX}${name}.json`), 'utf8'),
      );
      await expect(Worker.runReplayHistory({ workflowsPath }, history)).resolves.toBeUndefined();
    },
    60_000,
  );
});

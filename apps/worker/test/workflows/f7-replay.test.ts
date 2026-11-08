import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';
import {
  DECIDE_APPROVAL_UPDATE_NAME,
  FIRE_SCHEDULE_WORKFLOW_NAME,
  type RunEvent,
} from '@cognitive-dag/contracts';
import type { StartScheduledRunInput } from '../../src/schedules/activities';
import { definition, edge, mock, node, trigger } from '../helpers/dags';
import { eventsOf, runEngine, waitFor, workflowsPath } from '../support/engine';

const historiesDir = path.resolve(__dirname, '../histories');
const PREFIX = 'f7-';

/**
 * Histories of the F7 workflows. When the interpreter or the launcher change in a way that breaks
 * their replay, the change needs `patched()` (research R1): never just regenerate them. To record them
 * again on purpose: `RECORD_HISTORIES=1 pnpm --filter @cognitive-dag/worker test`.
 */
const approvalDag = definition(
  [
    trigger(),
    node('ask', 'human.approval', {
      message: 'Aprueba {{nodes.trigger.output.tone}}',
      timeoutSeconds: 3600,
    }),
    mock('go'),
    mock('stop'),
  ],
  [edge('trigger', 'ask'), edge('ask', 'go', 'approved'), edge('ask', 'stop', 'rejected')],
);

const httpDag = definition(
  [
    node('hook', 'trigger.webhook', { bodySchema: [] }),
    node('call', 'http.request', {
      method: 'POST',
      url: 'https://example.com/x',
      headers: {},
      body: '{}',
    }),
    mock('after'),
  ],
  [edge('hook', 'call'), edge('call', 'after')],
);

const scheduleDag = definition(
  [node('tick', 'trigger.schedule', { cron: '0 9 * * *', timezone: 'UTC' }), mock('after')],
  [edge('tick', 'after')],
);

async function recordApproval(env: TestWorkflowEnvironment, name: string) {
  const run = await runEngine(env, {
    dag: approvalDag,
    input: { triggerInput: { amount: 1, tone: 'happy' } },
    during: async (current) => {
      await waitFor(() => eventsOf(current, 'approval.requested').length > 0);
      await current.handle.executeUpdate(DECIDE_APPROVAL_UPDATE_NAME, {
        args: [{ nodeId: 'ask', decision: 'approved', decidedBy: randomUUID(), comment: 'ok' }],
      });
      await current.result();
      writeFileSync(
        path.join(historiesDir, `${name}.json`),
        historyToJSON(await current.handle.fetchHistory()),
      );
    },
  });
  expect(run.done).not.toBeInstanceOf(Error);
}

async function recordHttp(env: TestWorkflowEnvironment, name: string) {
  await runEngine(env, {
    dag: httpDag,
    input: { triggerKind: 'webhook', triggerInput: { a: 1 } },
    during: async (current) => {
      await current.result();
      writeFileSync(
        path.join(historiesDir, `${name}.json`),
        historyToJSON(await current.handle.fetchHistory()),
      );
    },
  });
}

async function recordFire(env: TestWorkflowEnvironment, name: string) {
  const taskQueue = `gen-${randomUUID()}`;
  const events: RunEvent[] = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: {
      startScheduledRun: (value: StartScheduledRunInput) => {
        const runId = randomUUID();
        return Promise.resolve({
          status: 'started' as const,
          runId,
          temporalWorkflowId: `run-${runId}`,
          executionTimeoutSeconds: 1860,
          input: {
            organizationId: value.organizationId,
            workflowId: value.workflowId,
            versionId: randomUUID(),
            versionNumber: 1,
            runId,
            correlationId: value.correlationId,
            definition: scheduleDag,
            triggerInput: {},
            executablePhases: ['F3', 'F7'],
            triggerKind: 'schedule',
            scheduledAt: value.scheduledAt,
          },
        });
      },
      recordRunEvent: (event: RunEvent) => {
        events.push(event);
        return Promise.resolve();
      },
      mockService: () => Promise.resolve({ output: { ok: true }, attempts: 1 }),
    },
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start(FIRE_SCHEDULE_WORKFLOW_NAME, {
      taskQueue,
      workflowId: `sched-${randomUUID()}-gen`,
      args: [{ organizationId: randomUUID(), workflowId: randomUUID() }],
    });
    await handle.result();
    writeFileSync(
      path.join(historiesDir, `${name}.json`),
      historyToJSON(await handle.fetchHistory()),
    );
  });
}

const recorders: Record<string, (env: TestWorkflowEnvironment, name: string) => Promise<void>> = {
  'f7-execute-dag-approval': recordApproval,
  'f7-execute-dag-http': recordHttp,
  'f7-fire-schedule': recordFire,
};

describe.skipIf(!process.env.RECORD_HISTORIES)('recording of the F7 histories', () => {
  it('records the stored histories', async () => {
    const env = await TestWorkflowEnvironment.createLocal();
    try {
      for (const [name, record] of Object.entries(recorders)) await record(env, name);
    } finally {
      await env.teardown();
    }
  }, 180_000);
});

describe('F7 replay', () => {
  const files = readdirSync(historiesDir).filter((f) => f.startsWith(PREFIX));

  it('has a stored history for every scenario', () => {
    expect(files.sort()).toEqual(
      Object.keys(recorders)
        .map((name) => `${name}.json`)
        .sort(),
    );
  });

  it.each(Object.keys(recorders))(
    'replays the recorded %s history without non-determinism errors',
    async (name) => {
      const history: unknown = JSON.parse(
        readFileSync(path.join(historiesDir, `${name}.json`), 'utf8'),
      );
      await expect(Worker.runReplayHistory({ workflowsPath }, history)).resolves.toBeUndefined();
    },
    60_000,
  );
});

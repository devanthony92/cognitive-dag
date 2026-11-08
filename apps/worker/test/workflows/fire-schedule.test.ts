import { randomUUID } from 'node:crypto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIRE_SCHEDULE_WORKFLOW_NAME,
  type ExecuteDagInput,
  type RunEvent,
} from '@cognitive-dag/contracts';
import type {
  StartScheduledRunInput,
  StartScheduledRunResult,
} from '../../src/schedules/activities';
import type { FireScheduleResult } from '../../src/workflows/fire-schedule.workflow';
import { definition, edge, mock, node } from '../helpers/dags';
import { workflowsPath } from '../support/engine';

const dag = definition(
  [node('tick', 'trigger.schedule', { cron: '0 9 * * *', timezone: 'UTC' }), mock('after')],
  [edge('tick', 'after')],
);

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

async function fire(
  start: (input: StartScheduledRunInput) => StartScheduledRunResult,
  options: { workflowStartDelayMs?: number } = {},
) {
  const taskQueue = `test-${randomUUID()}`;
  const starts: StartScheduledRunInput[] = [];
  const events: RunEvent[] = [];
  const input = { organizationId: randomUUID(), workflowId: randomUUID() };
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: {
      startScheduledRun: (value: StartScheduledRunInput) => {
        starts.push(value);
        return Promise.resolve(start(value));
      },
      recordRunEvent: (event: RunEvent) => {
        events.push(event);
        return Promise.resolve();
      },
      mockService: async () => {
        await new Promise((resolve) => setTimeout(resolve, options.workflowStartDelayMs ?? 0));
        return { output: { ok: true }, attempts: 1 };
      },
    },
  });
  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start(FIRE_SCHEDULE_WORKFLOW_NAME, {
      taskQueue,
      workflowId: `sched-${input.workflowId}-test`,
      args: [input],
    });
    const result = (await handle.result()) as FireScheduleResult;
    const history = await handle.fetchHistory();
    return { result, starts, events, input, history, taskQueue };
  });
}

function startedRun(overrides: Partial<ExecuteDagInput> = {}) {
  return (value: StartScheduledRunInput): StartScheduledRunResult => {
    const runId = randomUUID();
    return {
      status: 'started',
      runId,
      temporalWorkflowId: `run-${runId}`,
      executionTimeoutSeconds: 1860,
      input: {
        organizationId: value.organizationId,
        workflowId: value.workflowId,
        versionId: randomUUID(),
        versionNumber: 3,
        runId,
        correlationId: value.correlationId,
        definition: dag,
        triggerInput: {},
        executablePhases: ['F3', 'F7'],
        triggerKind: 'schedule',
        scheduledAt: value.scheduledAt,
        ...overrides,
      },
    };
  };
}

describe('fireSchedule', () => {
  it('asks the activity for the run at the moment of the firing and waits for the child', async () => {
    const { result, starts, events, input } = await fire(startedRun(), {
      workflowStartDelayMs: 300,
    });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      organizationId: input.organizationId,
      workflowId: input.workflowId,
    });
    // One correlation id per firing, and the programmed time is an ISO date.
    expect(starts[0]!.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(starts[0]!.scheduledAt))).toBe(false);
    expect(result.status).toBe('finished');
    // The child ran to its end before the launcher finished.
    expect(events.at(-1)).toMatchObject({ transition: 'run.finished', status: 'succeeded' });
  });

  it('starts executeDag as a child that outlives the launcher (ABANDON)', async () => {
    const { history, starts } = await fire(startedRun());
    const initiated = history.events?.find(
      (event) => event.startChildWorkflowExecutionInitiatedEventAttributes,
    );
    const attributes = initiated?.startChildWorkflowExecutionInitiatedEventAttributes;
    expect(attributes?.workflowType?.name).toBe('executeDag');
    // PARENT_CLOSE_POLICY_ABANDON in the Temporal API enum.
    expect(Number(attributes?.parentClosePolicy)).toBe(2);
    expect(attributes?.workflowId).toMatch(/^run-/);
    expect(starts).toHaveLength(1);
  });

  it('ends without a run when the activity skips the firing', async () => {
    for (const reason of ['no_active_version', 'triggers_disabled', 'run_limit_reached'] as const) {
      const { result, events, history } = await fire(() => ({ status: 'skipped', reason }));
      expect(result).toEqual({ status: 'skipped', reason });
      expect(events).toHaveLength(0);
      expect(
        history.events?.some((event) => event.startChildWorkflowExecutionInitiatedEventAttributes),
      ).toBe(false);
    }
  });
});

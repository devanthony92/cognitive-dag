import { randomUUID } from 'node:crypto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DECIDE_APPROVAL_UPDATE_NAME,
  type DecideApprovalUpdateInput,
  type DecideApprovalUpdateResult,
  type ExecuteDagResult,
} from '@cognitive-dag/contracts';
import { approvalWaitBudgetMs, DagDefinitionSchema } from '@cognitive-dag/dag-schema';
import { definition, edge, mock, node, trigger } from '../helpers/dags';
import { eventsOf, runEngine, waitFor, type EngineRun } from '../support/engine';

const DECIDER = randomUUID();

/** trigger -> ask -(approved)-> go ; -(rejected)-> stop ; -(timeout)-> late */
const dag = (timeoutSeconds = 3600, message = 'Aprueba el pedido') =>
  definition(
    [
      trigger(),
      node('ask', 'human.approval', { message, timeoutSeconds }),
      mock('go'),
      mock('stop'),
      mock('late'),
    ],
    [
      edge('trigger', 'ask'),
      edge('ask', 'go', 'approved'),
      edge('ask', 'stop', 'rejected'),
      edge('ask', 'late', 'timeout'),
    ],
  );

const decide = (
  run: EngineRun,
  overrides: Partial<DecideApprovalUpdateInput> = {},
): Promise<DecideApprovalUpdateResult> =>
  run.handle.executeUpdate<DecideApprovalUpdateResult, [DecideApprovalUpdateInput]>(
    DECIDE_APPROVAL_UPDATE_NAME,
    {
      args: [{ nodeId: 'ask', decision: 'approved', decidedBy: DECIDER, ...overrides }],
    },
  );

const waitUntilRequested = (run: EngineRun) =>
  waitFor(() => eventsOf(run, 'approval.requested').length > 0);

const stepsRun = (run: EngineRun) =>
  eventsOf(run, 'step.succeeded').map((event) => (event as { nodeId: string }).nodeId);

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe('human.approval', () => {
  it('records the request and waits without holding an activity slot', async () => {
    // One activity slot only: if the wait held it, nothing else could run on this worker.
    const run = await runEngine(env, {
      dag: dag(3600, 'Aprueba el pedido {{nodes.trigger.output.tone}}'),
      maxConcurrentActivities: 1,
      input: { triggerInput: { amount: 1, tone: 'happy' } },
      during: async (current) => {
        await waitUntilRequested(current);
        const requested = eventsOf(current, 'approval.requested')[0] as {
          nodeLabel: string;
          expiresAt: string;
        };
        expect(requested.nodeLabel).toBe('ask');
        expect(Date.parse(requested.expiresAt) - Date.now()).toBeGreaterThan(3_500_000);
        // The step is running and marked as waiting for the approval.
        const running = current.events.filter(
          (event) => event.transition === 'step.running' && event.nodeId === 'ask',
        );
        expect(running[0]).toMatchObject({ waitingReason: 'approval' });
        // The email goes out with the resolved message as an input, so it lives in the history.
        await waitFor(() => current.notified.length > 0);
        expect(current.notified[0]).toMatchObject({
          nodeId: 'ask',
          message: 'Aprueba el pedido happy',
        });
        expect(await decide(current)).toEqual({ accepted: true });
      },
    });
    expect((run.done as ExecuteDagResult).outputs).toMatchObject({
      ask: { decision: 'approved', approvedBy: DECIDER },
      go: { ok: true },
    });
    expect(stepsRun(run)).toContain('go');
    expect(stepsRun(run)).not.toContain('stop');
    const resolved = eventsOf(run, 'approval.resolved')[0];
    expect(resolved).toMatchObject({ outcome: 'approved', decidedBy: DECIDER, hasComment: false });
  });

  it('takes the rejected branch without failing the run', async () => {
    const run = await runEngine(env, {
      dag: dag(),
      during: async (current) => {
        await waitUntilRequested(current);
        expect(
          await decide(current, { decision: 'rejected', comment: 'No es el momento' }),
        ).toEqual({ accepted: true });
      },
    });
    expect((run.done as ExecuteDagResult).status).toBe('succeeded');
    expect(stepsRun(run)).toContain('stop');
    expect(stepsRun(run)).not.toContain('go');
    expect(eventsOf(run, 'approval.resolved')[0]).toMatchObject({
      outcome: 'rejected',
      decidedBy: DECIDER,
      hasComment: true,
    });
    // The text of the comment is never part of an event.
    expect(JSON.stringify(run.events)).not.toContain('No es el momento');
    expect(eventsOf(run, 'run.finished')[0]).toMatchObject({ status: 'succeeded' });
  });

  it('the first decision wins and the second is refused', async () => {
    const run = await runEngine(env, {
      dag: dag(),
      during: async (current) => {
        await waitUntilRequested(current);
        const [first, second] = await Promise.all([
          decide(current, { decision: 'approved' }),
          decide(current, { decision: 'rejected' }),
        ]);
        const results = [first, second];
        expect(results.filter((result) => result.accepted)).toHaveLength(1);
        expect(results.find((result) => !result.accepted)).toEqual({
          accepted: false,
          reason: 'already_resolved',
        });
      },
    });
    expect((run.done as ExecuteDagResult).status).toBe('succeeded');
    expect(eventsOf(run, 'approval.resolved')).toHaveLength(1);
  });

  it('refuses an unknown node and a node that is not waiting yet', async () => {
    const slow = definition(
      [
        trigger(),
        mock('wait', { latencyMs: 1500 }),
        node('ask', 'human.approval', { message: 'ok', timeoutSeconds: 3600 }),
        mock('go'),
      ],
      [edge('trigger', 'wait'), edge('wait', 'ask'), edge('ask', 'go', 'approved')],
    );
    const run = await runEngine(env, {
      dag: slow,
      activities: {
        mockService: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return { output: { ok: true }, attempts: 1 };
        },
      },
      during: async (current) => {
        expect(await decide(current, { nodeId: 'ghost' })).toEqual({
          accepted: false,
          reason: 'unknown_node',
        });
        expect(await decide(current)).toEqual({ accepted: false, reason: 'not_waiting' });
        await waitUntilRequested(current);
        expect(await decide(current)).toEqual({ accepted: true });
      },
    });
    expect((run.done as ExecuteDagResult).status).toBe('succeeded');
  });

  it('cancelling the run while it waits leaves the request cancelled', async () => {
    const run = await runEngine(env, {
      dag: dag(),
      during: async (current) => {
        await waitUntilRequested(current);
        await current.handle.cancel();
      },
    });
    expect(run.done).toBeInstanceOf(Error);
    expect(eventsOf(run, 'approval.resolved')[0]).toMatchObject({
      outcome: 'cancelled',
      hasComment: false,
    });
    expect(eventsOf(run, 'run.finished')[0]).toMatchObject({ status: 'cancelled' });
    expect(
      eventsOf(run, 'step.cancelled').map((event) => (event as { nodeId: string }).nodeId),
    ).toEqual(['ask']);
  });

  it('the run duration grows with the deadlines of its approvals', async () => {
    const parsed = DagDefinitionSchema.parse(dag(7200));
    expect(approvalWaitBudgetMs(parsed)).toBe(7_200_000);
    const base = 2_000;
    // With only the base duration the run times out while it waits; with the budget it does not.
    const tooShort = await runEngine(env, {
      dag: dag(3600),
      input: { maxDurationMs: base },
    });
    expect(eventsOf(tooShort, 'run.finished')[0]).toMatchObject({ status: 'timed_out' });
    expect(eventsOf(tooShort, 'approval.resolved')[0]).toMatchObject({ outcome: 'cancelled' });

    const extended = await runEngine(env, {
      dag: dag(3600),
      input: { maxDurationMs: base + approvalWaitBudgetMs(DagDefinitionSchema.parse(dag(3600))) },
      during: async (current) => {
        await waitUntilRequested(current);
        await new Promise((resolve) => setTimeout(resolve, base + 500));
        expect(await decide(current)).toEqual({ accepted: true });
      },
    });
    expect((extended.done as ExecuteDagResult).status).toBe('succeeded');
  });

  // Temporal's dev server has no time skipping here, so this one waits the minimum real deadline.
  it('times out into the timeout branch, and a late decision is refused', async () => {
    const withTail = definition(
      [
        trigger(),
        node('ask', 'human.approval', { message: 'ok', timeoutSeconds: 60 }),
        mock('late'),
        mock('tail'),
      ],
      [edge('trigger', 'ask'), edge('ask', 'late', 'timeout'), edge('late', 'tail')],
    );
    const run = await runEngine(env, {
      dag: withTail,
      activities: {
        mockService: async (input: { nodeId: string }) => {
          // Keeps the run open after the deadline so the late decision reaches a live workflow.
          if (input.nodeId === 'tail') await new Promise((resolve) => setTimeout(resolve, 3000));
          return { output: { ok: true }, attempts: 1 };
        },
      },
      during: async (current) => {
        await waitUntilRequested(current);
        await waitFor(() => eventsOf(current, 'approval.resolved').length > 0, 75_000);
        expect(eventsOf(current, 'approval.resolved')[0]).toMatchObject({
          outcome: 'timed_out',
          hasComment: false,
        });
        expect(await decide(current)).toEqual({ accepted: false, reason: 'already_resolved' });
      },
    });
    expect((run.done as ExecuteDagResult).outputs).toMatchObject({
      ask: { decision: 'timeout', approvedBy: '' },
      late: { ok: true },
    });
    expect(eventsOf(run, 'approval.resolved')[0]).not.toHaveProperty('decidedBy');
  }, 120_000);
});

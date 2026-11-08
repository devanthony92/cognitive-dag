import { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DagDefinitionSchema, findUnsupportedNodes } from '@cognitive-dag/dag-schema';
import type { ExecuteDagResult } from '@cognitive-dag/contracts';
import { definition, edge, mock, node } from '../helpers/dags';
import { runEngine } from '../support/engine';

const webhook = (bodySchema: unknown[] = []) => node('hook', 'trigger.webhook', { bodySchema });
const schedule = () => node('tick', 'trigger.schedule', { cron: '0 9 * * *', timezone: 'UTC' });

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe('trigger.webhook', () => {
  const dag = definition([webhook(), mock('after')], [edge('hook', 'after')]);

  it('outputs the body the API validated and lets the DAG continue', async () => {
    const run = await runEngine(env, {
      dag,
      input: { triggerKind: 'webhook', triggerInput: { orderId: 'A-1', total: 42 } },
    });
    expect((run.done as ExecuteDagResult).status).toBe('succeeded');
    expect((run.done as ExecuteDagResult).outputs).toMatchObject({
      hook: { orderId: 'A-1', total: 42 },
      after: { ok: true },
    });
  });
});

describe('trigger.schedule', () => {
  const dag = definition([schedule(), mock('after')], [edge('tick', 'after')]);

  it('outputs the programmed time of the firing', async () => {
    const scheduledAt = '2026-11-07T09:00:00.000Z';
    const run = await runEngine(env, {
      dag,
      input: { triggerKind: 'schedule', scheduledAt },
    });
    expect((run.done as ExecuteDagResult).outputs).toMatchObject({
      tick: { firedAt: scheduledAt },
      after: { ok: true },
    });
  });

  it('falls back to the workflow clock when no time was given', async () => {
    const run = await runEngine(env, { dag, input: { triggerKind: 'schedule' } });
    const outputs = (run.done as ExecuteDagResult).outputs as { tick: { firedAt: string } };
    expect(Number.isNaN(Date.parse(outputs.tick.firedAt))).toBe(false);
  });
});

describe('executable phases', () => {
  const dag = definition([webhook(), mock('m')], [edge('hook', 'm')]);

  it('findUnsupportedNodes blocks F7 nodes without the F7 phase and accepts them with it', () => {
    const parsed = DagDefinitionSchema.parse(dag);
    expect(findUnsupportedNodes(parsed, ['F3']).map((n) => n.type)).toEqual(['trigger.webhook']);
    expect(findUnsupportedNodes(parsed, ['F3', 'F7'])).toEqual([]);
  });

  it('a run without the F7 phase fails UNSUPPORTED_NODES before any node runs', async () => {
    const run = await runEngine(env, { dag, input: { executablePhases: ['F3'] } });
    expect(run.done).toBeInstanceOf(Error);
    const finished = run.events.find((event) => event.transition === 'run.finished');
    expect(finished).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_NODES' });
    expect(run.events.some((event) => event.transition === 'step.running')).toBe(false);
  });
});

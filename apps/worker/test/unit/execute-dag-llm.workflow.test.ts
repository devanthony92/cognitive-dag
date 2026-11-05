import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LlmError, FakeProvider, type FakeStep } from '@cognitive-dag/llm';
import { createLogger } from '@cognitive-dag/logger';
import {
  EXECUTE_DAG_WORKFLOW_NAME,
  type ExecuteDagInput,
  type ExecuteDagResult,
  type RunEvent,
} from '@cognitive-dag/contracts';
import { createLlmActivities } from '../../src/llm/activities';
import { classifyNode, definition, edge, generateNode, trigger } from '../helpers/dags';
import { MODELS, memoryBudget } from '../helpers/llm';

const workflowsPath = path.resolve(__dirname, '../../src/workflows');
const logger = createLogger({ component: 'worker-test', level: 'silent' });

const LLM_QUEUE = 'test-llm-queue';
const PHASES: ExecuteDagInput['executablePhases'] = ['F3', 'F5'];

describe('executeDag with LLM nodes', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  /**
   * Two workers, as in production: the main queue serves the recording and the LLM queue serves
   * the real LLM activities over a scripted provider and an in-memory budget.
   */
  async function execute(
    dag: ReturnType<typeof definition>,
    options: {
      script?: readonly FakeStep[];
      budget?: ReturnType<typeof memoryBudget>;
      executablePhases?: ExecuteDagInput['executablePhases'];
      memoized?: Record<string, unknown>;
    } = {},
  ) {
    const provider = new FakeProvider(options.script);
    const memory = options.budget ?? memoryBudget();
    const events: RunEvent[] = [];
    const mainQueue = `test-${randomUUID()}`;

    const llmWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: LLM_QUEUE,
      activities: {
        ...createLlmActivities({
          logger,
          provider,
          budget: memory.budget,
          enabled: true,
          models: MODELS,
          prices: new Map(),
          maxInputChars: 10_000,
        }),
      },
    });
    const mainWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: mainQueue,
      workflowsPath,
      activities: {
        recordRunEvent: (event: RunEvent) => {
          events.push(event);
          return Promise.resolve();
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
      definition: dag,
      triggerInput: { amount: 150, tone: 'happy' },
      llmTaskQueue: LLM_QUEUE,
      ...(options.executablePhases === undefined
        ? { executablePhases: PHASES }
        : { executablePhases: options.executablePhases }),
      ...(options.memoized === undefined ? {} : { memoized: options.memoized }),
    };
    const run = await llmWorker.runUntil(() =>
      mainWorker.runUntil(async () => {
        const handle = await env.client.workflow.start(EXECUTE_DAG_WORKFLOW_NAME, {
          taskQueue: mainQueue,
          workflowId: `run-${input.runId}`,
          args: [input],
        });
        const result = (await handle
          .result()
          .catch((error: unknown) =>
            error instanceof Error ? error : new Error(String(error)),
          )) as ExecuteDagResult | Error;
        const history = (await handle.fetchHistory()).events ?? [];
        return { result, history };
      }),
    );
    return { ...run, events, provider, memory };
  }

  const finished = (events: RunEvent[]) => {
    const event = events.find((e) => e.transition === 'run.finished');
    return event?.transition === 'run.finished' ? event : undefined;
  };
  const stepFailed = (events: RunEvent[], nodeId: string) =>
    events.find((e) => e.transition === 'step.failed' && e.nodeId === nodeId);

  const dagWith = (node: ReturnType<typeof classifyNode>) =>
    definition([trigger(), node], [edge('trigger', node.id)]);

  it('runs the three LLM nodes on their own task queue', async () => {
    const dag = definition(
      [trigger(), classifyNode('c'), generateNode('g')],
      [edge('trigger', 'c'), edge('c', 'g')],
    );
    const { result, history, provider } = await execute(dag);
    expect((result as ExecuteDagResult).status).toBe('succeeded');
    expect(provider.calls).toHaveLength(2);
    const queues = history
      .map((e) => e.activityTaskScheduledEventAttributes)
      .filter((a) => a != null)
      .map((a) => [a.activityType?.name, a.taskQueue?.name]);
    expect(queues).toContainEqual(['llmClassify', LLM_QUEUE]);
    expect(queues).toContainEqual(['llmGenerate', LLM_QUEUE]);
    expect(queues).toContainEqual(['recordRunEvent', expect.not.stringMatching(LLM_QUEUE)]);
  }, 30_000);

  it('does not retry invalid_output: the run fails with that class after one attempt', async () => {
    const { result, events, provider } = await execute(dagWith(classifyNode('c')), {
      script: [{ text: 'x' }, { text: 'y' }, { text: 'z' }],
    });
    expect(result).toBeInstanceOf(Error);
    expect(provider.calls).toHaveLength(3);
    expect(stepFailed(events, 'c')).toMatchObject({
      errorCode: 'LLM_INVALID_OUTPUT',
      errorClass: 'invalid_output',
    });
    expect(finished(events)).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_INVALID_OUTPUT',
      errorClass: 'invalid_output',
    });
  }, 30_000);

  it('does not retry budget_exhausted: the run fails with that class', async () => {
    const budget = memoryBudget({
      failWith: () => new LlmError('LLM_RUN_BUDGET_EXHAUSTED', 'sin presupuesto'),
    });
    const { result, events, provider } = await execute(dagWith(classifyNode('c')), { budget });
    expect(result).toBeInstanceOf(Error);
    expect(budget.reserved).toHaveLength(1);
    expect(provider.calls).toHaveLength(0);
    expect(finished(events)).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_RUN_BUDGET_EXHAUSTED',
      errorClass: 'budget_exhausted',
    });
  }, 30_000);

  it('retries a provider 5xx and a 429 under the policy of F4', async () => {
    const valid: FakeStep = { text: JSON.stringify({ label: 'positivo', confidence: 0.8 }) };
    const server = await execute(dagWith(classifyNode('c')), {
      script: [{ error: { status: 503 } }, valid],
    });
    expect((server.result as ExecuteDagResult).status).toBe('succeeded');
    expect(server.provider.calls).toHaveLength(2);

    const limited = await execute(dagWith(classifyNode('c')), {
      script: [{ error: { status: 429 } }, valid],
    });
    expect((limited.result as ExecuteDagResult).status).toBe('succeeded');
    expect(limited.provider.calls).toHaveLength(2);
  }, 60_000);

  it('does not run a reused LLM node: no activity and no budget', async () => {
    const dag = dagWith(classifyNode('c'));
    const { result, events, provider, memory } = await execute(dag, {
      memoized: { trigger: {}, c: { label: 'positivo', confidence: 1 } },
    });
    expect((result as ExecuteDagResult).status).toBe('succeeded');
    expect(provider.calls).toHaveLength(0);
    expect(memory.reserved).toHaveLength(0);
    expect(events.some((e) => e.transition === 'step.reused' && e.nodeId === 'c')).toBe(true);
  }, 30_000);

  it('refuses LLM nodes when the input does not allow F5', async () => {
    const { result, events, provider } = await execute(dagWith(classifyNode('c')), {
      executablePhases: ['F3'],
    });
    expect(result).toBeInstanceOf(Error);
    expect(provider.calls).toHaveLength(0);
    expect(finished(events)).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_NODES' });
  }, 30_000);
});

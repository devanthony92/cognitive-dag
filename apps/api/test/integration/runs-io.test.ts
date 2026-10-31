import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProblemDetailsSchema,
  RunSchema,
  StepIoSchema,
  temporalWorkflowIdFor,
} from '@cognitive-dag/contracts';
import { sql } from '@cognitive-dag/db';
import {
  amountDefinition,
  api,
  closeRunsEnv,
  publishedWorkflow,
  runPath,
  setupRunsEnv,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

const secretsDefinition = () => {
  const definition = amountDefinition();
  (definition.nodes[0] as { config: { inputSchema: unknown[] } }).config.inputSchema.push({
    name: 'password',
    type: { kind: 'string' },
  });
  return definition;
};

describe('step input and output from the Temporal history (requires docker compose up)', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv();
  });

  afterAll(async () => {
    await closeRunsEnv(env);
  });

  const ioPath = (runId: string, nodeId: string, organizationId = env.organization.id) =>
    `${runPath(organizationId, runId)}/steps/${nodeId}/io`;

  async function finishedRun(
    input: Record<string, unknown>,
    definition: unknown = amountDefinition(),
  ): Promise<string> {
    const workflowId = await publishedWorkflow(env, definition);
    const run = RunSchema.parse(
      (await startRun(env, env.owner, workflowId, input).expect(202)).body,
    );
    await waitForTerminal(env, env.owner, run.id);
    return run.id;
  }

  it('returns the trigger input and the node output', async () => {
    const runId = await finishedRun({ monto: 150, nota: 'hola' });

    const trigger = await api(env)
      .get(ioPath(runId, 'trigger'))
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    expect(StepIoSchema.parse(trigger.body)).toEqual({
      input: { monto: 150, nota: 'hola' },
      output: { monto: 150, nota: 'hola' },
      truncated: false,
    });

    const work = await api(env)
      .get(ioPath(runId, 'work'))
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    const io = StepIoSchema.parse(work.body);
    expect(io.output).toEqual({ ok: true });
    expect(io.input).toMatchObject({ config: { latencyMs: 100 } });
    expect(io.truncated).toBe(false);
  });

  it('redacts sensitive keys with the logger rules', async () => {
    const runId = await finishedRun(
      { monto: 1, nota: 'x', password: 'hunter2' },
      secretsDefinition(),
    );
    const response = await api(env)
      .get(ioPath(runId, 'trigger'))
      .set('Cookie', env.owner.cookie)
      .expect(200);
    const io = StepIoSchema.parse(response.body);
    expect(io.input).toMatchObject({ monto: 1, password: '[REDACTED]' });
    expect(JSON.stringify(io)).not.toContain('hunter2');
  });

  it('404 for a node the version does not have, and for another organization', async () => {
    const runId = await finishedRun({ monto: 1, nota: 'x' });
    await api(env).get(ioPath(runId, 'nope')).set('Cookie', env.owner.cookie).expect(404);
    const response = await api(env)
      .get(ioPath(runId, 'trigger'))
      .set('Cookie', env.outsider.cookie)
      .expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('NOT_FOUND');
  });

  it('410 STEP_IO_EXPIRED when the history no longer exists', async () => {
    const runId = await finishedRun({ monto: 1, nota: 'x' });
    // A purged history looks like a workflow id Temporal does not know.
    await env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      (tx) =>
        tx.execute(sql`UPDATE workflow_runs
          SET temporal_workflow_id = ${temporalWorkflowIdFor(randomUUID())}
          WHERE id = ${runId}`),
    );
    const response = await api(env)
      .get(ioPath(runId, 'trigger'))
      .set('Cookie', env.owner.cookie)
      .expect(410);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('STEP_IO_EXPIRED');
  });

  it('truncates a large payload and flags it', async () => {
    const runId = await finishedRun({ monto: 1, nota: 'x'.repeat(90_000) });
    const response = await api(env)
      .get(ioPath(runId, 'trigger'))
      .set('Cookie', env.owner.cookie)
      .expect(200);
    const io = StepIoSchema.parse(response.body);
    expect(io.truncated).toBe(true);
    expect(JSON.stringify(io).length).toBeLessThan(80_000);
  });
});

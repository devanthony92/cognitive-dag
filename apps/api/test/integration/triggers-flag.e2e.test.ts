import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@cognitive-dag/db';
import { authHeaders } from './identity-helpers';
import {
  NO_TRIGGER_FLAGS,
  api,
  approvalDefinition,
  closeTriggersEnv,
  generateWebhook,
  orgPath,
  postHook,
  publishedWorkflow,
  scheduleDefinition,
  setupTriggersEnv,
  startManualRun,
  webhookDefinition,
  type TriggersEnv,
  problemOf,
} from './triggers-helpers';
import { createWorkflow, workflowsPath } from './workflows-helpers';

describe('with triggers-enabled off', () => {
  let off: TriggersEnv;

  beforeAll(async () => {
    off = await setupTriggersEnv({}, { flags: NO_TRIGGER_FLAGS, withWorker: false });
  }, 120_000);

  afterAll(async () => {
    await closeTriggersEnv(off);
  });

  it('answers 404 FEATURE_NOT_AVAILABLE on every F7 endpoint, the public webhook included', async () => {
    const workflow = await createWorkflow(off);
    const base = `${orgPath(off)}`;
    const w = `${workflowsPath(off.organization.id)}/${workflow.id}`;
    const id = randomUUID();
    const calls: [method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object][] = [
      ['get', `${w}/webhook`],
      ['post', `${w}/webhook/token`],
      ['get', `${w}/schedule`],
      ['get', `${base}/approvals`],
      ['get', `${base}/approvals/count`],
      ['get', `${base}/approvals/${id}`],
      ['post', `${base}/approvals/${id}/decision`, { decision: 'approved' }],
      ['get', `${base}/credentials`],
      ['post', `${base}/credentials`, { name: 'x', kind: 'bearer', secret: 'x' }],
      ['put', `${base}/credentials/${id}`, { secret: 'x' }],
      ['delete', `${base}/credentials/${id}`],
      ['get', `${base}/http-allowed-hosts`],
      ['post', `${base}/http-allowed-hosts`, { pattern: 'a.example.com' }],
      ['delete', `${base}/http-allowed-hosts/${id}`],
    ];
    for (const [method, path, body] of calls) {
      const response = await api(off)[method](path).set(authHeaders(off.owner)).send(body);
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(problemOf(response).code).toBe('FEATURE_NOT_AVAILABLE');
    }
    const hook = await postHook(off, `/api/v1/hooks/${randomUUID()}/cdw_${'A'.repeat(43)}`);
    expect(hook.status).toBe(404);
    expect(problemOf(hook).code).toBe('FEATURE_NOT_AVAILABLE');
  });

  it('does not create schedules, and a version with F7 nodes fails with UNSUPPORTED_NODES', async () => {
    const withSchedule = await publishedWorkflow(off, scheduleDefinition());
    const rows = await off.database.withContext(
      { userId: off.owner.body.user.id, organizationId: off.organization.id },
      async (tx) => {
        return tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM workflow_schedules WHERE workflow_id = ${withSchedule.id}`,
        );
      },
    );
    expect(rows.rows[0]?.n).toBe(0);

    // A person starts a run of a version with an approval node: the engine refuses it.
    const approval = await publishedWorkflow(off, approvalDefinition());
    const response = await api(off)
      .post(`${workflowsPath(off.organization.id)}/${approval.id}/runs`)
      .set(authHeaders(off.owner))
      .send({ input: {} });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'WORKFLOW_NOT_RUNNABLE',
      reason: 'unsupported_nodes',
    });
    expect(JSON.stringify(problemOf(response).nodes)).toContain('human.approval');
  });
});

describe('with triggers-enabled on', () => {
  let on: TriggersEnv;

  beforeAll(async () => {
    on = await setupTriggersEnv();
  }, 120_000);

  afterAll(async () => {
    await closeTriggersEnv(on);
  });

  it('includes the F7 phase: a version with F7 nodes starts, and the webhook runs', async () => {
    const approval = await publishedWorkflow(on, approvalDefinition());
    const run = await startManualRun(on, on.owner, approval.id);
    expect(run.status).toBe('queued');
    await api(on)
      .post(`${orgPath(on)}/runs/${run.id}/cancel`)
      .set(authHeaders(on.owner));

    const hooked = await publishedWorkflow(on, webhookDefinition());
    const hook = await generateWebhook(on, hooked.id);
    await postHook(on, hook.path).expect(202);
  });
});

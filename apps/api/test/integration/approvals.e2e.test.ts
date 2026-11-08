import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Approval, ApprovalDetail, ApprovalList, Run } from '@cognitive-dag/contracts';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import type { RunTemporalService } from '../../src/runs/run-history.service';
import { authHeaders, resetRateLimits } from './identity-helpers';
import { joinAs } from './members-helpers';
import { waitFor } from './ping-helpers';
import {
  api,
  approvalDefinition,
  closeTriggersEnv,
  generateWebhook,
  hookHeaders,
  orgPath,
  postHook,
  publishedWorkflow,
  setupTriggersEnv,
  startManualRun,
  waitForPending,
  webhookApprovalDefinition,
  type TriggersEnv,
  problemOf,
} from './triggers-helpers';

let env: TriggersEnv;

beforeAll(async () => {
  env = await setupTriggersEnv();
}, 120_000);

afterAll(async () => {
  await closeTriggersEnv(env);
});

const decide = (
  approvalId: string,
  session: TriggersEnv['owner'],
  body: { decision: 'approved' | 'rejected'; comment?: string },
) =>
  api(env)
    .post(`${orgPath(env)}/approvals/${approvalId}/decision`)
    .set(authHeaders(session))
    .send(body);

const listAs = async (session: TriggersEnv['owner'], status = 'pending'): Promise<ApprovalList> =>
  (
    await api(env)
      .get(`${orgPath(env)}/approvals?status=${status}`)
      .set(authHeaders(session))
      .expect(200)
  ).body as ApprovalList;

const countAs = async (session: TriggersEnv['owner']): Promise<number> => {
  const response = await api(env)
    .get(`${orgPath(env)}/approvals/count`)
    .set(authHeaders(session))
    .expect(200);
  return (response.body as { pending: number }).pending;
};

const runOf = async (runId: string): Promise<Run> =>
  (
    await api(env)
      .get(`${orgPath(env)}/runs/${runId}`)
      .set(authHeaders(env.owner))
      .expect(200)
  ).body as Run;

/** The owner starts a run that waits for a person; returns the run and its approval. */
async function waiting(message = 'Aprueba el pedido') {
  const workflow = await publishedWorkflow(env, approvalDefinition(message));
  const run = await startManualRun(env, env.owner, workflow.id);
  const [approval] = await waitForPending(env, env.editor);
  return { workflow, run, approval: approval! };
}

describe('the inbox', () => {
  it('shows each person only what they can decide, with a count that agrees', async () => {
    const before = await countAs(env.editor);
    const { run, approval } = await waiting();
    expect(approval.runId).toBe(run.id);
    expect(approval).toMatchObject({ status: 'pending', canDecide: true, nodeId: 'ask' });

    // The owner started the run: it is not theirs to decide, so it is not in their inbox.
    expect((await listAs(env.owner)).items.map((item) => item.id)).not.toContain(approval.id);
    expect((await listAs(env.editor)).items.map((item) => item.id)).toContain(approval.id);
    expect(await countAs(env.editor)).toBe(before + 1);
    expect(await countAs(env.owner)).toBe(0);

    // The message is not in the list: it lives only in Temporal.
    expect(JSON.stringify(await listAs(env.editor))).not.toContain('Aprueba el pedido');
    await api(env)
      .post(`${orgPath(env)}/runs/${run.id}/cancel`)
      .set(authHeaders(env.owner));
  });

  it('is closed to viewers and to other organizations', async () => {
    for (const path of ['approvals', 'approvals/count']) {
      const denied = await api(env)
        .get(`${orgPath(env)}/${path}`)
        .set(authHeaders(env.viewer));
      expect(denied.status).toBe(403);
      await api(env)
        .get(`${orgPath(env)}/${path}`)
        .set(authHeaders(env.outsider))
        .expect(404);
    }
  });
});

describe('deciding', () => {
  it('approves with a comment: the run goes on, the history keeps it and the comment is only in Temporal', async () => {
    const { run, approval } = await waiting('Aprueba el pedido 42');

    const detail = await api(env)
      .get(`${orgPath(env)}/approvals/${approval.id}`)
      .set(authHeaders(env.editor))
      .expect(200);
    expect((detail.body as ApprovalDetail).message).toBe('Aprueba el pedido 42');

    // Who started the run cannot decide it (7A).
    const own = await decide(approval.id, env.owner, { decision: 'approved' }).expect(403);
    expect(problemOf(own).code).toBe('APPROVAL_SELF_DECISION_FORBIDDEN');
    // A viewer cannot either.
    await decide(approval.id, env.viewer, { decision: 'approved' }).expect(403);

    const decided = await decide(approval.id, env.editor, {
      decision: 'approved',
      comment: 'Todo en orden',
    }).expect(200);
    expect(decided.body as Approval).toMatchObject({
      status: 'approved',
      hasComment: true,
      decidedBy: { id: env.editor.body.user.id },
    });
    await waitFor(async () => ((await runOf(run.id)).status === 'succeeded' ? true : undefined));

    const resolved = await listAs(env.editor, 'resolved');
    expect(resolved.items.map((item) => item.id)).toContain(approval.id);
    const after = await api(env)
      .get(`${orgPath(env)}/approvals/${approval.id}`)
      .set(authHeaders(env.secondEditor))
      .expect(200);
    expect(after.body as ApprovalDetail).toMatchObject({
      status: 'approved',
      message: 'Aprueba el pedido 42',
      comment: 'Todo en orden',
    });

    // Deciding again: the first decision won.
    const late = await decide(approval.id, env.secondEditor, { decision: 'rejected' }).expect(409);
    expect(problemOf(late).code).toBe('APPROVAL_ALREADY_RESOLVED');
  });

  it('rejects without a comment and the run still ends well, down the rejected branch', async () => {
    const { run, approval } = await waiting();
    const decided = await decide(approval.id, env.secondEditor, { decision: 'rejected' }).expect(
      200,
    );
    expect(decided.body).toMatchObject({ status: 'rejected', hasComment: false });
    await waitFor(async () => ((await runOf(run.id)).status === 'succeeded' ? true : undefined));
  });

  it('answers 409 when the run is over before the decision arrives', async () => {
    const { run, approval } = await waiting();
    await api(env)
      .post(`${orgPath(env)}/runs/${run.id}/cancel`)
      .set(authHeaders(env.owner))
      .expect(202);
    await waitFor(async () => ((await runOf(run.id)).status === 'cancelled' ? true : undefined));
    const response = await decide(approval.id, env.editor, { decision: 'approved' }).expect(409);
    expect(problemOf(response).code).toBe('APPROVAL_ALREADY_RESOLVED');
  });

  it('refuses a person who lost the role, at once', async () => {
    const { approval } = await waiting();
    const editor = await joinAs(env.app, env.database, env.owner, env.organization.id, 'editor');
    await api(env)
      .patch(`${orgPath(env)}/members/${editor.membershipId}`)
      .set(authHeaders(env.owner))
      .send({ role: 'viewer' })
      .expect(200);
    await decide(approval.id, editor.session, { decision: 'approved' }).expect(403);
    await api(env)
      .post(`${orgPath(env)}/approvals/${approval.id}/decision`)
      .set(authHeaders(env.editor))
      .send({ decision: 'rejected' })
      .expect(200);
  });

  it('lets any owner or editor decide a run started by a webhook', async () => {
    await resetRateLimits();
    const workflow = await publishedWorkflow(env, webhookApprovalDefinition());
    const hook = await generateWebhook(env, workflow.id);
    await postHook(env, hook.path, {}, hookHeaders()).expect(202);
    const [approval] = await waitForPending(env, env.owner);
    expect(approval!.canDecide).toBe(true);
    // The owner decides: nobody started this run, so nobody is excluded.
    await decide(approval!.id, env.owner, { decision: 'approved' }).expect(200);
  });
});

describe('the detail', () => {
  it('answers 410 when Temporal no longer has the history, and keeps the metadata', async () => {
    const { run, approval } = await waiting();
    // The instance the approvals service uses (another module has its own copy).
    const temporal = env.app.get<{ temporal: RunTemporalService }>(ApprovalsService).temporal;
    const original = temporal.history.bind(temporal);
    temporal.history = () => Promise.resolve(undefined);
    try {
      const gone = await api(env)
        .get(`${orgPath(env)}/approvals/${approval.id}`)
        .set(authHeaders(env.editor))
        .expect(410);
      expect(problemOf(gone).code).toBe('APPROVAL_CONTENT_EXPIRED');
    } finally {
      temporal.history = original;
    }
    // The metadata is still in the list.
    expect((await listAs(env.editor)).items.map((item) => item.id)).toContain(approval.id);
    await api(env)
      .post(`${orgPath(env)}/runs/${run.id}/cancel`)
      .set(authHeaders(env.owner));
  });

  it('answers 404 for an approval of another organization', async () => {
    const { run, approval } = await waiting();
    await api(env)
      .get(`${orgPath(env)}/approvals/${approval.id}`)
      .set(authHeaders(env.outsider))
      .expect(404);
    await api(env)
      .get(`/api/v1/organizations/${env.outsiderOrganization.id}/approvals/${approval.id}`)
      .set(authHeaders(env.outsider))
      .expect(404);
    await decide(approval.id, env.outsider, { decision: 'approved' }).expect(404);
    await api(env)
      .post(`${orgPath(env)}/runs/${run.id}/cancel`)
      .set(authHeaders(env.owner));
  });

  it('validates the decision and the comment', async () => {
    const { run, approval } = await waiting();
    await decide(approval.id, env.editor, { decision: 'maybe' as 'approved' }).expect(422);
    await decide(approval.id, env.editor, {
      decision: 'approved',
      comment: 'x'.repeat(501),
    }).expect(422);
    await api(env)
      .post(`${orgPath(env)}/runs/${run.id}/cancel`)
      .set(authHeaders(env.owner));
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@cognitive-dag/db';
import type { Approval, Run, WebhookAccepted } from '@cognitive-dag/contracts';
import { authHeaders, resetRateLimits } from './identity-helpers';
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
  webhookDefinition,
  type TriggersEnv,
} from './triggers-helpers';
import { setLimitsAsOperator } from './workflows-helpers';

/**
 * Closing security batteries of F7 (T065). They gather in one place what the earlier PRs proved
 * piece by piece, as the evidence for SC-001, SC-003, SC-005 and SC-007. SC-002 (SSRF) lives in
 * packages/connectors/test/ssrf-battery.test.ts, SC-004 in apps/worker/test/chaos/triggers.chaos.test.ts
 * and SC-006 in packages/connectors/test/circuit-breaker.test.ts and apps/worker/test/http.
 *
 * The values below are recognizable canaries, not real secrets.
 */
const BODY_CANARY = 'BODY-CANARY-0001';
const SECRET_CANARY = 'SECRET-CANARY-0002';
const MESSAGE_CANARY = 'MESSAGE-CANARY-0003';
const COMMENT_CANARY = 'COMMENT-CANARY-0004';

let env: TriggersEnv;

beforeAll(async () => {
  env = await setupTriggersEnv();
  await setLimitsAsOperator(env.organization.id, {
    maxNodes: 50,
    maxEdges: 100,
    maxDefinitionBytes: 262_144,
    maxConcurrentRuns: 50,
  });
}, 120_000);

afterAll(async () => {
  await closeTriggersEnv(env);
});

const bodyDefinition = () => webhookDefinition([{ name: 'nota', type: { kind: 'string' } }], 100);

async function runsOf(workflowId: string): Promise<number> {
  const result = await env.database.withContext(
    { userId: env.owner.body.user.id, organizationId: env.organization.id },
    (tx) =>
      tx.execute<{ n: string }>(sql`SELECT count(*) AS n FROM workflow_runs
        WHERE workflow_id = ${workflowId}`),
  );
  return Number(result.rows[0]?.n ?? 0);
}

describe('SC-001: invalid, regenerated, stale and repeated calls start nothing extra', () => {
  it('accepts one run and rejects or deduplicates every other call', async () => {
    await resetRateLimits();
    const workflow = await publishedWorkflow(env, bodyDefinition());
    const first = await generateWebhook(env, workflow.id);
    const second = await generateWebhook(env, workflow.id);
    const tokenOf = (path: string) => path.split('/').pop()!;
    const flip = (path: string) => `${path.slice(0, -1)}${path.endsWith('A') ? 'B' : 'A'}`;
    const unknownTrigger = second.path.replace(/hooks\/[^/]+/, `hooks/${randomUUID()}`);
    expect(tokenOf(first.path)).not.toBe(tokenOf(second.path));

    const eventId = randomUUID();
    const accepted = await postHook(env, second.path, { nota: 'ok' }, hookHeaders(eventId)).expect(
      202,
    );
    const runId = (accepted.body as WebhookAccepted).runId;

    const rejected = [
      await postHook(env, first.path, { nota: 'x' }).expect(401), // regenerated
      await postHook(env, flip(second.path), { nota: 'x' }).expect(401), // altered
      await postHook(env, unknownTrigger, { nota: 'x' }).expect(401), // unknown trigger
    ];
    // Invalid token: the same answer whatever the reason, so nothing tells them apart.
    const shapes = rejected.map((response) => JSON.stringify(response.body));
    expect(
      new Set(shapes.map((s) => s.replace(/"(instance|traceId|correlationId)":"[^"]*"/g, ''))).size,
    ).toBe(1);

    // Stale and future timestamps, missing and malformed event ids.
    for (const at of [new Date(Date.now() - 10 * 60_000), new Date(Date.now() + 10 * 60_000)]) {
      const response = await postHook(env, second.path, { nota: 'x' }, hookHeaders(undefined, at));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'WEBHOOK_TIMESTAMP_INVALID' });
    }
    const noEventId = hookHeaders() as Record<string, string>;
    delete noEventId['X-Event-Id'];
    const missing = await postHook(env, second.path, { nota: 'x' }, noEventId);
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ code: 'WEBHOOK_EVENT_ID_INVALID' });

    // Replay: the same event id answers with the same run and starts nothing.
    for (let i = 0; i < 3; i += 1) {
      const replay = await postHook(env, second.path, { nota: 'ok' }, hookHeaders(eventId)).expect(
        200,
      );
      expect(replay.body).toMatchObject({ runId, duplicate: true });
    }

    await waitFor(async () => ((await runsOf(workflow.id)) === 1 ? true : undefined), 15_000);
    expect(await runsOf(workflow.id)).toBe(1);
  });
});

describe('SC-003 and SC-007: no canary in any row or response', () => {
  it('keeps the body, the secret, the message and the comment out of PostgreSQL', async () => {
    await resetRateLimits();
    const bodies: string[] = [];

    // A webhook run with a body that carries a canary, and its response.
    const hooked = await publishedWorkflow(env, bodyDefinition());
    const hook = await generateWebhook(env, hooked.id);
    const hookToken = hook.path.split('/').pop()!;
    const accepted = await postHook(env, hook.path, { nota: BODY_CANARY }).expect(202);
    bodies.push(JSON.stringify(accepted.body));
    const hookRun = (accepted.body as WebhookAccepted).runId;
    await waitFor(async () => {
      const run = await api(env)
        .get(`${orgPath(env)}/runs/${hookRun}`)
        .set(authHeaders(env.owner));
      bodies.push(JSON.stringify(run.body));
      return (run.body as Run).status === 'succeeded' ? true : undefined;
    }, 30_000);

    // A credential whose secret is a canary, created, listed and rotated.
    const created = await api(env)
      .post(`${orgPath(env)}/credentials`)
      .set(authHeaders(env.owner))
      .send({ name: `Cierre ${Date.now()}`, kind: 'bearer', secret: SECRET_CANARY })
      .expect(201);
    bodies.push(JSON.stringify(created.body));
    bodies.push(
      JSON.stringify(
        (
          await api(env)
            .get(`${orgPath(env)}/credentials`)
            .set(authHeaders(env.owner))
            .expect(200)
        ).body,
      ),
    );

    // An approval whose message resolves to a canary from the webhook body (the definition itself
    // holds only the template), decided with a comment canary.
    const template = webhookApprovalDefinition();
    template.nodes[0]!.config = { bodySchema: [{ name: 'nota', type: { kind: 'string' } }] };
    template.nodes[1]!.config = {
      message: 'Aprueba {{nodes.hook.output.nota}}',
      timeoutSeconds: 3600,
    };
    const workflow = await publishedWorkflow(env, template);
    const approvalHook = await generateWebhook(env, workflow.id);
    const started = await postHook(env, approvalHook.path, { nota: MESSAGE_CANARY }).expect(202);
    const run = { id: (started.body as WebhookAccepted).runId };
    const [approval] = (await waitForPending(env, env.secondEditor, 1)).filter(
      (item) => item.runId === run.id,
    ) as [Approval];
    for (const path of [
      `approvals?status=pending`,
      `approvals/count`,
      `approvals/${approval.id}`,
    ]) {
      const response = await api(env)
        .get(`${orgPath(env)}/${path}`)
        .set(authHeaders(env.secondEditor));
      // The detail does show the message to the person who decides it; the list does not.
      if (path !== `approvals/${approval.id}`) bodies.push(JSON.stringify(response.body));
    }
    const decided = await api(env)
      .post(`${orgPath(env)}/approvals/${approval.id}/decision`)
      .set(authHeaders(env.secondEditor))
      .send({ decision: 'approved', comment: COMMENT_CANARY })
      .expect(200);
    bodies.push(JSON.stringify(decided.body));
    await waitFor(async () => {
      const finished = await api(env)
        .get(`${orgPath(env)}/runs/${run.id}`)
        .set(authHeaders(env.owner));
      bodies.push(JSON.stringify(finished.body));
      return (finished.body as Run).status === 'succeeded' ? true : undefined;
    }, 30_000);

    // Every row the organization can see, as text, in the clear, hex and base64.
    const canaries = [BODY_CANARY, SECRET_CANARY, MESSAGE_CANARY, COMMENT_CANARY];
    const tables = (
      await env.database.withContext(
        { userId: env.owner.body.user.id, organizationId: env.organization.id },
        (tx) =>
          tx.execute<{ table_name: string }>(
            sql`SELECT tablename AS table_name FROM pg_tables WHERE schemaname = 'public'`,
          ),
      )
    ).rows.map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'approvals',
        'credentials',
        'webhook_triggers',
        'workflow_runs',
        'workflow_run_steps',
        'node_effects',
      ]),
    );
    const dumps: string[] = [];
    for (const table of tables) {
      const rows = await env.database.withContext(
        { userId: env.owner.body.user.id, organizationId: env.organization.id },
        (tx) =>
          tx.execute<{ row: string }>(
            sql`SELECT t::text AS row FROM ${sql.identifier(table)} AS t`,
          ),
      );
      dumps.push(...rows.rows.map((row) => row.row));
    }
    expect(dumps.length).toBeGreaterThan(20);
    const haystack = [...dumps, ...bodies].join('\n');
    for (const canary of canaries) {
      for (const form of [
        canary,
        Buffer.from(canary).toString('hex'),
        Buffer.from(canary).toString('base64'),
      ]) {
        expect(haystack, `${canary} (${form === canary ? 'plain' : 'encoded'})`).not.toContain(
          form,
        );
      }
    }
    // The webhook token appears nowhere either: only its SHA-256 is stored.
    expect(haystack).not.toContain(hookToken);
  });
});

describe('7A: who started the run cannot approve it', () => {
  it('forbids the starter, lets another editor decide, and keeps the starter out of the inbox', async () => {
    await resetRateLimits();
    const workflow = await publishedWorkflow(env, approvalDefinition('Aprobar cierre', 3600));
    const run = await startManualRun(env, env.owner, workflow.id);
    const pending = (await waitForPending(env, env.secondEditor, 1)).find(
      (item) => item.runId === run.id,
    );
    expect(pending).toBeDefined();
    const decide = (session: TriggersEnv['owner']) =>
      api(env)
        .post(`${orgPath(env)}/approvals/${pending!.id}/decision`)
        .set(authHeaders(session))
        .send({ decision: 'approved' });
    const own = await decide(env.owner);
    expect(own.status).toBe(403);
    expect(own.body).toMatchObject({ code: 'APPROVAL_SELF_DECISION_FORBIDDEN' });
    expect((await decide(env.viewer)).status).toBe(403);
    expect((await decide(env.outsider)).status).toBe(404);
    await decide(env.secondEditor).expect(200);
    expect((await decide(env.editor)).status).toBe(409);
  });
});

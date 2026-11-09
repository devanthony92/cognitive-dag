import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Run, WebhookAccepted } from '@cognitive-dag/contracts';
import { authHeaders, resetRateLimits } from './identity-helpers';
import { httpServer, startTestApp } from './helpers';
import { waitFor } from './ping-helpers';
import {
  TRIGGER_FLAGS,
  closeTriggersEnv,
  generateWebhook,
  hookHeaders,
  orgPath,
  postHook,
  publishedWorkflow,
  setupTriggersEnv,
  webhookDefinition,
  type TriggersEnv,
  problemOf,
} from './triggers-helpers';
import {
  createWorkflow,
  publish,
  saveDraft,
  setLimitsAsOperator,
  workflowsPath,
  api,
} from './workflows-helpers';

let env: TriggersEnv;

beforeAll(async () => {
  env = await setupTriggersEnv();
}, 120_000);

afterAll(async () => {
  await closeTriggersEnv(env);
});

beforeEach(async () => {
  // The budget of failed attempts is per address and every test comes from the same one.
  await resetRateLimits();
});

const runOf = async (runId: string): Promise<Run> => {
  const response = await api(env)
    .get(`${orgPath(env)}/runs/${runId}`)
    .set(authHeaders(env.owner))
    .expect(200);
  return response.body as Run;
};

/** A workflow with the webhook generated and a published version. */
async function hooked(definition: unknown = webhookDefinition()) {
  const workflow = await publishedWorkflow(env, definition);
  const hook = await generateWebhook(env, workflow.id);
  return { workflow, hook };
}

describe('POST /api/v1/hooks/{triggerId}/{token}', () => {
  it('answers 202 with the run, which records its origin as a webhook', async () => {
    const { hook } = await hooked();
    const eventId = `evt-${randomUUID()}`;
    const response = await postHook(env, hook.path, {}, hookHeaders(eventId)).expect(202);
    const accepted = response.body as WebhookAccepted;
    expect(accepted.duplicate).toBe(false);
    const run = await runOf(accepted.runId);
    expect(run.triggeredBy).toBeNull();
    expect(run.trigger).toMatchObject({ kind: 'webhook', eventId });
    await waitFor(async () =>
      (await runOf(accepted.runId)).status === 'succeeded' ? true : undefined,
    );
  });

  it('answers the same 401 for a tampered token and for a trigger that does not exist', async () => {
    const { hook } = await hooked();
    const tampered = `${hook.path.slice(0, -1)}${hook.path.endsWith('A') ? 'B' : 'A'}`;
    const wrong = await postHook(env, tampered).expect(401);
    const [, , , , triggerId] = hook.path.split('/');
    const missing = await postHook(
      env,
      `/api/v1/hooks/${randomUUID()}/${hook.path.split('/').pop()}`,
    ).expect(401);
    const malformed = await postHook(env, `/api/v1/hooks/${triggerId}/not-a-token`).expect(401);
    for (const response of [wrong, missing, malformed]) {
      expect(response.body).toMatchObject({ code: 'WEBHOOK_TOKEN_INVALID', status: 401 });
    }
    expect(problemOf(missing).detail).toBe(problemOf(wrong).detail);
  });

  it('rejects the token that was regenerated and accepts the new one', async () => {
    const { workflow, hook } = await hooked();
    const fresh = await generateWebhook(env, workflow.id);
    await postHook(env, hook.path).expect(401);
    await postHook(env, fresh.path).expect(202);
  });

  it('rejects a timestamp outside ±5 minutes and a missing or malformed event id with 400', async () => {
    const { hook } = await hooked();
    const old = new Date(Date.now() - 6 * 60_000);
    const future = new Date(Date.now() + 6 * 60_000);
    for (const at of [old, future]) {
      const response = await postHook(env, hook.path, {}, hookHeaders(randomUUID(), at)).expect(
        400,
      );
      expect(problemOf(response).code).toBe('WEBHOOK_TIMESTAMP_INVALID');
    }
    const { 'X-Event-Timestamp': _skipped, ...withoutTimestamp } = hookHeaders();
    await postHook(env, hook.path, {}, withoutTimestamp).expect(400);

    const { 'X-Event-Id': _id, ...withoutEvent } = hookHeaders();
    const missing = await postHook(env, hook.path, {}, withoutEvent).expect(400);
    expect(problemOf(missing).code).toBe('WEBHOOK_EVENT_ID_INVALID');
    const bad = await postHook(env, hook.path, {}, hookHeaders('has spaces!')).expect(400);
    expect(problemOf(bad).code).toBe('WEBHOOK_EVENT_ID_INVALID');
  });

  it('answers 200 with the original run for a repeated event id, and starts one run in a race', async () => {
    const { workflow, hook } = await hooked();
    const eventId = `dup-${randomUUID()}`;
    const first = await postHook(env, hook.path, {}, hookHeaders(eventId)).expect(202);
    const again = await postHook(env, hook.path, {}, hookHeaders(eventId)).expect(200);
    expect(again.body).toMatchObject({
      duplicate: true,
      runId: (first.body as WebhookAccepted).runId,
    });

    const raced = `race-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postHook(env, hook.path, {}, hookHeaders(raced))),
    );
    expect(results.filter((response) => response.status === 202)).toHaveLength(1);
    expect(results.filter((response) => response.status === 200)).toHaveLength(4);
    expect(new Set(results.map((response) => (response.body as WebhookAccepted).runId)).size).toBe(
      1,
    );

    const list = await api(env)
      .get(`${workflowsPath(env.organization.id)}/${workflow.id}/runs`)
      .set(authHeaders(env.owner))
      .expect(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(2);
  });

  it('answers 415, 413 and 422 for a body that is not acceptable', async () => {
    const { hook } = await hooked(webhookDefinition([{ name: 'monto', type: { kind: 'number' } }]));
    await request(httpServer(env.app))
      .post(hook.path)
      .set({ ...hookHeaders(), 'Content-Type': 'text/plain' })
      .send('hola')
      .expect(415);
    const big = await postHook(env, hook.path, { monto: 1, relleno: 'x'.repeat(70_000) }).expect(
      413,
    );
    expect(problemOf(big).code).toBe('PAYLOAD_TOO_LARGE');
    const invalid = await postHook(env, hook.path, { monto: 'no es un número' }).expect(422);
    expect(problemOf(invalid).code).toBe('VALIDATION_FAILED');
    await request(httpServer(env.app))
      .post(hook.path)
      .set(hookHeaders())
      .send('{no es json')
      .expect(422);
    await postHook(env, hook.path, [1, 2, 3]).expect(422);
    await postHook(env, hook.path, { monto: 5 }).expect(202);
  });

  it('answers 409 WEBHOOK_NOT_ACTIVE for a workflow with no active webhook version', async () => {
    const workflow = await createWorkflow(env);
    const hook = await generateWebhook(env, workflow.id);
    const response = await postHook(env, hook.path).expect(409);
    expect(problemOf(response).code).toBe('WEBHOOK_NOT_ACTIVE');
  });

  it('runs the version that is active when the event arrives', async () => {
    const { workflow, hook } = await hooked();
    // The draft was saved once (revision 2); the new text goes in on top of it.
    const second = await saveDraft(
      env,
      env.owner,
      workflow.id,
      2,
      webhookDefinition([], 150),
    ).expect(200);
    await publish(
      env,
      env.owner,
      workflow.id,
      (second.body as { revision: number }).revision,
    ).expect(201);
    const response = await postHook(env, hook.path).expect(202);
    expect((await runOf((response.body as WebhookAccepted).runId)).versionNumber).toBe(2);
  });

  it('limits each trigger to 60 calls per minute and each address to 20 failed attempts', async () => {
    const { hook } = await hooked();
    const limited = { ...hookHeaders(), 'Content-Type': 'text/plain' };
    for (let i = 0; i < 60; i += 1) {
      await request(httpServer(env.app)).post(hook.path).set(limited).send('x').expect(415);
    }
    const blocked = await request(httpServer(env.app))
      .post(hook.path)
      .set(limited)
      .send('x')
      .expect(429);
    expect(problemOf(blocked).code).toBe('WEBHOOK_RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    await resetRateLimits();
    const other = await hooked();
    const wrong = other.hook.path.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    for (let i = 0; i < 20; i += 1) await postHook(env, wrong).expect(401);
    // The address is out of attempts: even the right token waits.
    const wait = await postHook(env, other.hook.path).expect(429);
    expect(problemOf(wait).code).toBe('WEBHOOK_RATE_LIMITED');
    expect(Number(wait.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('answers 429 RUN_LIMIT_REACHED while the organization is at its limit', async () => {
    const { hook } = await hooked(webhookDefinition([], 4_000));
    await setLimitsAsOperator(env.organization.id, {
      maxNodes: 50,
      maxEdges: 100,
      maxDefinitionBytes: 262_144,
      maxConcurrentRuns: 1,
    });
    try {
      // Runs of the earlier tests may still be going and would take the only place.
      await waitFor(async () => {
        const open = await Promise.all(
          ['queued', 'running'].map((status) =>
            api(env)
              .get(`${orgPath(env)}/runs?status=${status}`)
              .set(authHeaders(env.owner)),
          ),
        );
        return open.every((r) => (r.body as { items: unknown[] }).items.length === 0)
          ? true
          : undefined;
      });
      await postHook(env, hook.path).expect(202);
      const response = await postHook(env, hook.path).expect(429);
      expect(problemOf(response).code).toBe('RUN_LIMIT_REACHED');
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await setLimitsAsOperator(env.organization.id, {
        maxNodes: 50,
        maxEdges: 100,
        maxDefinitionBytes: 262_144,
        maxConcurrentRuns: 5,
      });
    }
  });
});

describe('without Valkey', () => {
  let app: INestApplication | undefined;
  afterAll(async () => {
    await app?.close();
  });

  it('fails closed with 503 when Valkey does not answer', async () => {
    app = await startTestApp({
      FEATURE_FLAGS: TRIGGER_FLAGS,
      VALKEY_URL: 'redis://127.0.0.1:6399',
    });
    const response = await postHook(
      { app },
      `/api/v1/hooks/${randomUUID()}/cdw_${'A'.repeat(43)}`,
    ).expect(503);
    expect(problemOf(response).code).toBe('SERVICE_UNAVAILABLE');
    await app.close();
    app = undefined;
  });
});

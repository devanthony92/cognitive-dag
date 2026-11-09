import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeaders } from './identity-helpers';
import {
  api,
  approvalDefinition,
  closeTriggersEnv,
  generateWebhook,
  orgPath,
  postHook,
  publishedWorkflow,
  setupTriggersEnv,
  startManualRun,
  webhookDefinition,
  type TriggersEnv,
} from './triggers-helpers';

describe('the F7 phase', () => {
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

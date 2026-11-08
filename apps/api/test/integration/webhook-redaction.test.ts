import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { redactHookPath, serializeRequest } from '../../src/logging/redact-hook-path';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { hashWebhookToken } from '../../src/webhooks/webhook-token';
import { authHeaders, resetRateLimits } from './identity-helpers';
import {
  api,
  closeTriggersEnv,
  generateWebhook,
  hookHeaders,
  postHook,
  publishedWorkflow,
  setupTriggersEnv,
  webhookDefinition,
  type TriggersEnv,
} from './triggers-helpers';
import { workflowsPath } from './workflows-helpers';

describe('redactHookPath', () => {
  const id = randomUUID();
  it('keeps the trigger id and hides everything after it', () => {
    expect(redactHookPath(`/api/v1/hooks/${id}/cdw_${'A'.repeat(43)}`)).toBe(
      `/api/v1/hooks/${id}/[REDACTED]`,
    );
    expect(redactHookPath(`/api/v1/hooks/${id}/cdw_${'A'.repeat(43)}?x=1`)).toBe(
      `/api/v1/hooks/${id}/[REDACTED]?x=1`,
    );
  });
  it('hides a token put where the trigger id belongs, and leaves other URLs alone', () => {
    expect(redactHookPath(`/api/v1/hooks/cdw_${'A'.repeat(43)}`)).toBe('/api/v1/hooks/[REDACTED]');
    expect(redactHookPath('/api/v1/organizations/x/runs')).toBe('/api/v1/organizations/x/runs');
  });
});

let env: TriggersEnv;

beforeAll(async () => {
  env = await setupTriggersEnv();
}, 120_000);

afterAll(async () => {
  await closeTriggersEnv(env);
});

describe('the webhook token is nowhere (SC-003)', () => {
  it('stays out of the access log line, security events and responses, valid or not', async () => {
    await resetRateLimits();
    const emitted: unknown[] = [];
    const logger = env.app.get(SecurityEventLogger);
    const emit = logger.emit.bind(logger);
    vi.spyOn(logger, 'emit').mockImplementation((event) => {
      emitted.push(event);
      emit(event);
    });

    const workflow = await publishedWorkflow(env, webhookDefinition());
    const first = await generateWebhook(env, workflow.id);
    const second = await generateWebhook(env, workflow.id);
    const tokenOf = (path: string) => path.split('/').pop()!;
    const wrong = `${second.path.slice(0, -1)}${second.path.endsWith('A') ? 'B' : 'A'}`;
    const paths = [second.path, first.path, wrong];
    const tokens = paths.map(tokenOf);

    const responses = [
      await postHook(env, second.path, {}).expect(202), // valid
      await postHook(env, first.path, {}).expect(401), // regenerated
      await postHook(env, wrong, {}).expect(401), // altered
      await postHook(env, second.path, {}, { ...hookHeaders(), 'X-Event-Id': 'bad id' }).expect(
        400,
      ),
      await postHook(env, second.path, { relleno: 'x' }).expect(422),
    ];
    await api(env)
      .get(`${workflowsPath(env.organization.id)}/${workflow.id}/webhook`)
      .set(authHeaders(env.owner))
      .expect(200);

    // What the access log writes for each of these requests.
    const logged = paths.map((path) =>
      JSON.stringify(serializeRequest({ method: 'POST', url: path })),
    );
    const hashes = tokens.map((token) => hashWebhookToken(token).toString('hex'));
    const haystack = [
      ...logged,
      JSON.stringify(emitted),
      ...responses.map(
        (response) => JSON.stringify(response.body) + JSON.stringify(response.headers),
      ),
    ].join('\n');
    for (const token of tokens) expect(haystack).not.toContain(token);
    for (const hash of hashes) expect(haystack).not.toContain(hash);
    for (const line of logged) expect(line).toContain('[REDACTED]');

    // The events say what happened and why, without the offending value.
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'webhook.accepted' }),
        expect.objectContaining({ event: 'webhook.rejected', reason: 'token' }),
        expect.objectContaining({ event: 'webhook.rejected', reason: 'event_id' }),
        expect.objectContaining({ event: 'webhook.token.generated' }),
      ]),
    );
  });
});

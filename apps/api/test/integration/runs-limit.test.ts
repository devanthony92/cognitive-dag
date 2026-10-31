import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LimitsSchema, ProblemDetailsSchema, RunSchema } from '@cognitive-dag/contracts';
import { sql } from '@cognitive-dag/db';
import { authHeaders } from './identity-helpers';
import {
  api,
  closeRunsEnv,
  publishedWorkflow,
  runPath,
  setupRunsEnv,
  slowDefinition,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';
import { freshOrganization, setLimitsAsOperator } from './workflows-helpers';

describe('concurrent run limit (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv();
  });

  afterAll(async () => {
    await closeRunsEnv(env);
  });

  async function organizationWithLimit(maxConcurrentRuns?: number) {
    const { session, organizationId } = await freshOrganization(env);
    if (maxConcurrentRuns !== undefined) {
      await setLimitsAsOperator(organizationId, {
        maxNodes: 50,
        maxEdges: 100,
        maxDefinitionBytes: 262_144,
        maxConcurrentRuns,
      });
    }
    const workflowId = await publishedWorkflow(env, slowDefinition(), organizationId, session);
    const target = { app: env.app, organization: { id: organizationId } } as Pick<
      RunsEnv,
      'app' | 'organization'
    >;
    return { session, organizationId, workflowId, target };
  }

  const inProgress = (organizationId: string, userId: string) =>
    env.database.withContext({ userId, organizationId }, async (tx) => {
      const result = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM workflow_runs
            WHERE organization_id = ${organizationId} AND status IN ('queued', 'running')`,
      );
      return result.rows[0]?.n ?? 0;
    });

  it('the limit is 1: the second run gets 429 RUN_LIMIT_REACHED until the first ends', async () => {
    const { session, workflowId, target, organizationId } = await organizationWithLimit(1);
    const first = RunSchema.parse(
      (await startRun(target, session, workflowId, undefined, organizationId).expect(202)).body,
    );

    const refused = await startRun(target, session, workflowId, undefined, organizationId).expect(
      429,
    );
    const problem = ProblemDetailsSchema.parse(refused.body);
    expect(problem.code).toBe('RUN_LIMIT_REACHED');
    expect(problem.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.headers['retry-after']).toBeDefined();

    // A rerun counts the same.
    await api(env)
      .post(`${runPath(organizationId, first.id)}/rerun`)
      .set(authHeaders(session))
      .expect(429);

    await api(env)
      .post(`${runPath(organizationId, first.id)}/cancel`)
      .set(authHeaders(session))
      .expect(202);
    await waitForTerminal(target, session, first.id);
    await startRun(target, session, workflowId, undefined, organizationId).expect(202);
  });

  it('simultaneous starts never exceed the limit (SC-005)', async () => {
    const { session, workflowId, target, organizationId } = await organizationWithLimit(3);
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        startRun(target, session, workflowId, undefined, organizationId),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 202)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(9);
    expect(await inProgress(organizationId, session.body.user.id)).toBe(3);
  });

  it('uses 5 when the organization has no limits of its own, and counts per organization', async () => {
    const { session, workflowId, target, organizationId } = await organizationWithLimit();
    const other = await organizationWithLimit(1);
    await startRun(
      other.target,
      other.session,
      other.workflowId,
      undefined,
      other.organizationId,
    ).expect(202);

    const responses = await Promise.all(
      Array.from({ length: 7 }, () =>
        startRun(target, session, workflowId, undefined, organizationId),
      ),
    );
    expect(responses.filter((response) => response.status === 202)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(2);
  });

  it('the limits endpoint returns maxConcurrentRuns', async () => {
    const own = await organizationWithLimit(2);
    const response = await api(env)
      .get(`/api/v1/organizations/${own.organizationId}/limits`)
      .set('Cookie', own.session.cookie)
      .expect(200);
    expect(LimitsSchema.parse(response.body)).toMatchObject({
      maxConcurrentRuns: 2,
      source: 'organization',
    });
    const defaults = await api(env)
      .get(`/api/v1/organizations/${env.organization.id}/limits`)
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(LimitsSchema.parse(defaults.body).maxConcurrentRuns).toBe(5);
  });
});

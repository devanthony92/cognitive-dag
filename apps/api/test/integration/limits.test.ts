import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LimitsSchema, ProblemDetailsSchema } from '@cognitive-dag/contracts';
import { authHeaders, startIdentityApp } from './identity-helpers';
import { uniqueTaskQueue } from './ping-helpers';
import {
  api,
  closeWorkflowsEnv,
  DAG_FLAGS,
  freshOrganization,
  setLimitsAsOperator,
  setupWorkflowsEnv,
  type WorkflowsEnv,
} from './workflows-helpers';

const limitsPath = (organizationId: string) => `/api/v1/organizations/${organizationId}/limits`;

describe('organization limits (requires docker compose up and pnpm db:migrate)', () => {
  let env: WorkflowsEnv;

  beforeAll(async () => {
    env = await setupWorkflowsEnv();
  });

  afterAll(async () => {
    await closeWorkflowsEnv(env);
  });

  it('returns the platform defaults when the organization has no limits of its own', async () => {
    const response = await api(env)
      .get(limitsPath(env.organization.id))
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    expect(LimitsSchema.parse(response.body)).toEqual({
      maxNodes: 50,
      maxEdges: 100,
      maxDefinitionBytes: 262_144,
      maxConcurrentRuns: 5,
      source: 'default',
    });
  });

  it('returns the limits set by the operator, and only for that organization', async () => {
    const { session, organizationId } = await freshOrganization(env);
    await setLimitsAsOperator(organizationId, {
      maxNodes: 3,
      maxEdges: 7,
      maxDefinitionBytes: 4096,
    });
    const own = await api(env)
      .get(limitsPath(organizationId))
      .set('Cookie', session.cookie)
      .expect(200);
    expect(LimitsSchema.parse(own.body)).toEqual({
      maxNodes: 3,
      maxEdges: 7,
      maxDefinitionBytes: 4096,
      maxConcurrentRuns: 5,
      source: 'organization',
    });
    const other = await api(env)
      .get(limitsPath(env.organization.id))
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(LimitsSchema.parse(other.body).source).toBe('default');
  });

  it('404 for an organization the user does not belong to', async () => {
    const response = await api(env)
      .get(limitsPath(env.organization.id))
      .set('Cookie', env.outsider.cookie)
      .expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('NOT_FOUND');
  });

  it('exposes no endpoint that writes limits, not even to the owner (FR-021)', async () => {
    for (const method of ['put', 'patch', 'post', 'delete'] as const) {
      const request = api(env)[method](limitsPath(env.organization.id));
      const response = await request
        .set(authHeaders(env.owner))
        .send({ maxNodes: 500 })
        .expect(404);
      expect(ProblemDetailsSchema.parse(response.body).code).toBe('ROUTE_NOT_FOUND');
    }
    const unchanged = await api(env)
      .get(limitsPath(env.organization.id))
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(LimitsSchema.parse(unchanged.body).maxNodes).toBe(50);
  });
});

describe('server ceilings on the limits', () => {
  let app: INestApplication;
  let env: WorkflowsEnv;

  beforeAll(async () => {
    env = await setupWorkflowsEnv(DAG_FLAGS);
    app = await startIdentityApp(DAG_FLAGS, {
      TEMPORAL_TASK_QUEUE: uniqueTaskQueue(),
      DAG_MAX_NODES_CEILING: 10,
      DAG_MAX_EDGES_CEILING: 20,
      DAG_MAX_DEFINITION_BYTES_CEILING: 8192,
    });
  });

  afterAll(async () => {
    await app.close();
    await closeWorkflowsEnv(env);
  });

  it('a ceiling lower than the defaults and than the limits of the organization wins', async () => {
    await setLimitsAsOperator(env.organization.id, {
      maxNodes: 40,
      maxEdges: 15,
      maxDefinitionBytes: 100_000,
    });
    // Same database, same session cookies: the second app only differs in its configuration.
    const response = await api({ app })
      .get(limitsPath(env.organization.id))
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(LimitsSchema.parse(response.body)).toEqual({
      maxNodes: 10,
      maxEdges: 15,
      maxDefinitionBytes: 8192,
      maxConcurrentRuns: 5,
      source: 'organization',
    });
  });
});

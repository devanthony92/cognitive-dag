import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ProblemDetailsSchema,
  SaveDraftResponseSchema,
  WorkflowSchema,
} from '@cognitive-dag/contracts';
import { authHeaders, resetRateLimits } from './identity-helpers';
import {
  api,
  closeWorkflowsEnv,
  createWorkflow,
  freshOrganization,
  invalidDefinition,
  quoted,
  saveDraft,
  setLimitsAsOperator,
  setupWorkflowsEnv,
  validDefinition,
  workflowsPath,
  type WorkflowsEnv,
} from './workflows-helpers';

async function expectProblem(response: request.Test, status: number, code: string) {
  const result = await response.expect(status);
  expect(result.headers['content-type']).toContain('application/problem+json');
  const problem = ProblemDetailsSchema.parse(result.body);
  expect(problem.code).toBe(code);
  return problem;
}

describe('workflow drafts (requires docker compose up and pnpm db:migrate)', () => {
  let env: WorkflowsEnv;
  const base = () => workflowsPath(env.organization.id);

  beforeAll(async () => {
    env = await setupWorkflowsEnv();
  });

  afterAll(async () => {
    await closeWorkflowsEnv(env);
  });

  beforeEach(resetRateLimits);

  it('saves a valid draft: new revision, ETag and a valid validation', async () => {
    const workflow = await createWorkflow(env);
    const response = await saveDraft(env, env.editor, workflow.id, 1, validDefinition()).expect(
      200,
    );
    const body = SaveDraftResponseSchema.parse(response.body);
    expect(body).toMatchObject({ revision: 2, validation: { valid: true, errors: [] } });
    expect(response.headers.etag).toBe('"2"');

    const read = await api(env)
      .get(`${base()}/${workflow.id}`)
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    const stored = WorkflowSchema.parse(read.body);
    expect(stored.draftRevision).toBe(2);
    expect(stored.draft).toMatchObject({ schemaVersion: 1 });
    expect(stored.draftValidation?.valid).toBe(true);
  });

  it('saves a draft with errors and returns the validation (FR-010)', async () => {
    const workflow = await createWorkflow(env);
    const response = await saveDraft(env, env.owner, workflow.id, 1, invalidDefinition()).expect(
      200,
    );
    const body = SaveDraftResponseSchema.parse(response.body);
    expect(body.revision).toBe(2);
    expect(body.validation.valid).toBe(false);
    expect(body.validation.errors.length).toBeGreaterThan(0);
    const [first] = body.validation.errors;
    expect(typeof first?.code).toBe('string');
    expect(typeof first?.message).toBe('string');
    expect(first?.location).toBeTypeOf('object');

    const read = await api(env)
      .get(`${base()}/${workflow.id}`)
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(WorkflowSchema.parse(read.body).draft).toEqual(invalidDefinition());
  });

  it('saves a draft whose node configuration is incomplete, with the errors reported', async () => {
    const workflow = await createWorkflow(env);
    const definition = validDefinition();
    (definition.nodes[1] as { config: unknown }).config = { latencyMs: -5 };
    const response = await saveDraft(env, env.owner, workflow.id, 1, definition).expect(200);
    const body = SaveDraftResponseSchema.parse(response.body);
    expect(body.validation.valid).toBe(false);
    expect(body.validation.errors.some((error) => error.location.node === 'work')).toBe(true);
  });

  it('428 PRECONDITION_REQUIRED without If-Match', async () => {
    const workflow = await createWorkflow(env);
    await expectProblem(
      api(env)
        .put(`${base()}/${workflow.id}/draft`)
        .set(authHeaders(env.owner))
        .send({ definition: validDefinition() }),
      428,
      'PRECONDITION_REQUIRED',
    );
  });

  it.each(['abc', '"0"', '"-1"', '*', '"1", "2"'])(
    '422 for the malformed If-Match %s',
    async (value) => {
      const workflow = await createWorkflow(env);
      await expectProblem(
        api(env)
          .put(`${base()}/${workflow.id}/draft`)
          .set(authHeaders(env.owner))
          .set('If-Match', value)
          .send({ definition: validDefinition() }),
        422,
        'VALIDATION_FAILED',
      );
    },
  );

  it.each([['"2"'], ['2'], ['W/"2"']])('accepts If-Match written as %s', async (value) => {
    const workflow = await createWorkflow(env);
    await saveDraft(env, env.owner, workflow.id, 1, validDefinition()).expect(200);
    await api(env)
      .put(`${base()}/${workflow.id}/draft`)
      .set(authHeaders(env.owner))
      .set('If-Match', value)
      .send({ definition: validDefinition() })
      .expect(200);
  });

  it('409 DRAFT_CONFLICT on a stale revision, leaving the draft untouched', async () => {
    const workflow = await createWorkflow(env);
    await saveDraft(env, env.owner, workflow.id, 1, validDefinition()).expect(200);
    await expectProblem(
      saveDraft(env, env.editor, workflow.id, 1, invalidDefinition()),
      409,
      'DRAFT_CONFLICT',
    );
    const read = await api(env)
      .get(`${base()}/${workflow.id}`)
      .set('Cookie', env.owner.cookie)
      .expect(200);
    const stored = WorkflowSchema.parse(read.body);
    expect(stored.draftRevision).toBe(2);
    expect((stored.draft as { nodes: unknown[] }).nodes).toHaveLength(2);
    expect(stored.draftValidation?.valid).toBe(true);
  });

  it('409 DRAFT_CONFLICT for a revision from the future', async () => {
    const workflow = await createWorkflow(env);
    await expectProblem(
      saveDraft(env, env.owner, workflow.id, 9, validDefinition()),
      409,
      'DRAFT_CONFLICT',
    );
  });

  it('two saves with the same revision: one wins, the other conflicts', async () => {
    const workflow = await createWorkflow(env);
    const results = await Promise.all([
      saveDraft(env, env.owner, workflow.id, 1, validDefinition()),
      saveDraft(env, env.editor, workflow.id, 1, invalidDefinition()),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  describe('definitions the server does not accept', () => {
    it('422 for an unknown field inside a node (FR-005, FR-011)', async () => {
      const workflow = await createWorkflow(env);
      const definition = validDefinition();
      (definition.nodes[0] as Record<string, unknown>).secretPlan = 'x';
      await expectProblem(
        saveDraft(env, env.owner, workflow.id, 1, definition),
        422,
        'VALIDATION_FAILED',
      );
    });

    it('422 for an unknown top-level field of the definition', async () => {
      const workflow = await createWorkflow(env);
      await expectProblem(
        saveDraft(env, env.owner, workflow.id, 1, { ...validDefinition(), extra: 1 }),
        422,
        'VALIDATION_FAILED',
      );
    });

    it('422 for an unknown field of the request body', async () => {
      const workflow = await createWorkflow(env);
      await expectProblem(
        api(env)
          .put(`${base()}/${workflow.id}/draft`)
          .set(authHeaders(env.owner))
          .set('If-Match', quoted(1))
          .send({ definition: validDefinition(), extra: true }),
        422,
        'VALIDATION_FAILED',
      );
    });

    it('422 for a credential-like key in a node configuration: secrets are never stored', async () => {
      const workflow = await createWorkflow(env);
      const definition = validDefinition();
      (definition.nodes[1] as { config: Record<string, unknown> }).config.apiKey = 'sk-test-123';
      await expectProblem(
        saveDraft(env, env.owner, workflow.id, 1, definition),
        422,
        'VALIDATION_FAILED',
      );
    });

    it.each([
      ['a definition that is not an object', 'texto'],
      ['nodes that is not a list', { schemaVersion: 1, nodes: 'x', edges: [] }],
      ['an unsupported schemaVersion', { schemaVersion: 2, nodes: [], edges: [] }],
    ])('422 for %s', async (_label, definition) => {
      const workflow = await createWorkflow(env);
      await expectProblem(
        saveDraft(env, env.owner, workflow.id, 1, definition),
        422,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('limits', () => {
    it('accepts a definition above the default request body limit but under the 256 KB default', async () => {
      const workflow = await createWorkflow(env);
      const definition = validDefinition({ padNodes: 20, pad: 8000 });
      expect(JSON.stringify(definition).length).toBeGreaterThan(150_000);
      const response = await saveDraft(env, env.owner, workflow.id, 1, definition).expect(200);
      expect(SaveDraftResponseSchema.parse(response.body).validation.valid).toBe(true);
    });

    it('413 LIMIT_EXCEEDED above the default 256 KB', async () => {
      const workflow = await createWorkflow(env);
      const definition = validDefinition({ padNodes: 30, pad: 9500 });
      expect(JSON.stringify(definition).length).toBeGreaterThan(262_144);
      await expectProblem(
        saveDraft(env, env.owner, workflow.id, 1, definition),
        413,
        'LIMIT_EXCEEDED',
      );
    });

    it('413 LIMIT_EXCEEDED above the limits of the organization, and not in others', async () => {
      const { session, organizationId } = await freshOrganization(env);
      await setLimitsAsOperator(organizationId, {
        maxNodes: 3,
        maxEdges: 5,
        maxDefinitionBytes: 2048,
      });
      const workflow = await createWorkflow(env, session, undefined, organizationId);

      // Four nodes against a limit of three.
      await expectProblem(
        saveDraft(env, session, workflow.id, 1, validDefinition({ padNodes: 2 }), organizationId),
        413,
        'LIMIT_EXCEEDED',
      );
      // Over 2048 bytes with only three nodes.
      await expectProblem(
        saveDraft(
          env,
          session,
          workflow.id,
          1,
          validDefinition({ padNodes: 1, pad: 5000 }),
          organizationId,
        ),
        413,
        'LIMIT_EXCEEDED',
      );
      await saveDraft(
        env,
        session,
        workflow.id,
        1,
        validDefinition({ padNodes: 1 }),
        organizationId,
      ).expect(200);

      // Another organization keeps the defaults.
      const other = await createWorkflow(env);
      await saveDraft(env, env.owner, other.id, 1, validDefinition({ padNodes: 2 })).expect(200);
    });
  });

  it('a viewer cannot save: 403', async () => {
    const workflow = await createWorkflow(env);
    await expectProblem(
      saveDraft(env, env.viewer, workflow.id, 1, validDefinition()),
      403,
      'FORBIDDEN',
    );
  });

  it('404 for an archived workflow and for one of another organization', async () => {
    const workflow = await createWorkflow(env);
    await expectProblem(
      saveDraft(env, env.outsider, workflow.id, 1, validDefinition()),
      404,
      'NOT_FOUND',
    );
    await api(env).delete(`${base()}/${workflow.id}`).set(authHeaders(env.owner)).expect(204);
    await expectProblem(
      saveDraft(env, env.owner, workflow.id, 1, validDefinition()),
      404,
      'NOT_FOUND',
    );
  });
});

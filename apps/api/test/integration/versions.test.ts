import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ProblemDetailsSchema,
  VersionSchema,
  VersionSummarySchema,
  WorkflowSchema,
} from '@cognitive-dag/contracts';
import { eq, workflowActiveVersions, workflowVersions } from '@cognitive-dag/db';
import { canonicalJson, definitionHash } from '../../src/workflows/canonical-json';
import { authHeaders, resetRateLimits } from './identity-helpers';
import {
  api,
  closeWorkflowsEnv,
  createWorkflow,
  freshOrganization,
  invalidDefinition,
  publish,
  quoted,
  saveDraft,
  setLimitsAsOperator,
  setupWorkflowsEnv,
  validDefinition,
  workflowsPath,
  workflowWithValidDraft,
  type WorkflowsEnv,
} from './workflows-helpers';

async function expectProblem(response: request.Test, status: number, code: string) {
  const result = await response.expect(status);
  expect(result.headers['content-type']).toContain('application/problem+json');
  const problem = ProblemDetailsSchema.parse(result.body);
  expect(problem.code).toBe(code);
  return problem;
}

describe('workflow versions (requires docker compose up and pnpm db:migrate)', () => {
  let env: WorkflowsEnv;
  const base = () => workflowsPath(env.organization.id);

  beforeAll(async () => {
    env = await setupWorkflowsEnv();
  });

  afterAll(async () => {
    await closeWorkflowsEnv(env);
  });

  beforeEach(resetRateLimits);

  const versions = async (workflowId: string) =>
    (
      await api(env)
        .get(`${base()}/${workflowId}/versions`)
        .set('Cookie', env.viewer.cookie)
        .expect(200)
    ).body as unknown[];

  /** The stored row of a version, read as the API reads it. */
  const storedVersion = (workflowId: string, number: number) =>
    env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      async (tx) => {
        const rows = await tx
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, workflowId));
        return rows.find((row) => row.versionNumber === number);
      },
    );

  it('publishes v1 and activates it, with the hash of the canonical definition', async () => {
    const workflow = await workflowWithValidDraft(env);
    const response = await publish(
      env,
      env.editor,
      workflow.id,
      workflow.revision,
      'primera',
    ).expect(201);
    const version = VersionSummarySchema.parse(response.body);
    expect(version).toMatchObject({
      number: 1,
      note: 'primera',
      nodeCount: 2,
      edgeCount: 1,
      nodeTypes: ['mock.service', 'trigger.manual'],
      active: true,
    });

    const stored = await storedVersion(workflow.id, 1);
    expect(stored).toBeDefined();
    expect(stored!.definitionHash.equals(definitionHash(stored!.definition))).toBe(true);
    expect(stored!.definitionHash).toHaveLength(32);

    const read = await api(env)
      .get(`${base()}/${workflow.id}`)
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    expect(WorkflowSchema.parse(read.body).activeVersionNumber).toBe(1);
  });

  it('the hash does not depend on the key order of the stored definition', () => {
    const a = { schemaVersion: 1, nodes: [{ b: 1, a: [2, { z: 1, y: 2 }] }], edges: [] };
    const b = { edges: [], nodes: [{ a: [2, { y: 2, z: 1 }], b: 1 }], schemaVersion: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(definitionHash(a).equals(definitionHash(b))).toBe(true);
  });

  it('publishes correlative, immutable versions (SC-006)', async () => {
    const workflow = await workflowWithValidDraft(env);
    await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
    const first = await storedVersion(workflow.id, 1);

    const changed = validDefinition({ padNodes: 1 });
    const saved = await saveDraft(env, env.owner, workflow.id, workflow.revision, changed).expect(
      200,
    );
    const second = await publish(
      env,
      env.owner,
      workflow.id,
      (saved.body as { revision: number }).revision,
    ).expect(201);
    expect(VersionSummarySchema.parse(second.body)).toMatchObject({
      number: 2,
      nodeCount: 3,
      note: null,
      active: true,
    });

    const list = await versions(workflow.id);
    expect(list.map((item) => (item as { number: number }).number)).toEqual([2, 1]);
    expect(list.map((item) => (item as { active: boolean }).active)).toEqual([true, false]);

    // v1 is the same bytes after v2 was published.
    const after = await storedVersion(workflow.id, 1);
    expect(after!.definition).toEqual(first!.definition);
    expect(after!.definitionHash.equals(first!.definitionHash)).toBe(true);
    const detail = await api(env)
      .get(`${base()}/${workflow.id}/versions/1`)
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    expect(VersionSchema.parse(detail.body).definition).toEqual(first!.definition);
  });

  it('422 DAG_INVALID with dagErrors when the draft has errors; no version is created', async () => {
    const workflow = await createWorkflow(env);
    const saved = await saveDraft(env, env.owner, workflow.id, 1, invalidDefinition()).expect(200);
    const problem = await expectProblem(
      publish(env, env.owner, workflow.id, (saved.body as { revision: number }).revision),
      422,
      'DAG_INVALID',
    );
    expect(problem.dagErrors?.length).toBeGreaterThan(0);
    expect(typeof problem.dagErrors?.[0]?.code).toBe('string');
    expect(await versions(workflow.id)).toEqual([]);
  });

  it('422 DAG_INVALID for a draft that is still empty', async () => {
    const workflow = await createWorkflow(env);
    await expectProblem(publish(env, env.owner, workflow.id, 1), 422, 'DAG_INVALID');
  });

  it('428 without If-Match and 409 DRAFT_CONFLICT on a stale revision', async () => {
    const workflow = await workflowWithValidDraft(env);
    await expectProblem(
      api(env).post(`${base()}/${workflow.id}/versions`).set(authHeaders(env.owner)),
      428,
      'PRECONDITION_REQUIRED',
    );
    await expectProblem(
      publish(env, env.owner, workflow.id, workflow.revision - 1),
      409,
      'DRAFT_CONFLICT',
    );
    expect(await versions(workflow.id)).toEqual([]);
  });

  it('a viewer cannot publish: 403', async () => {
    const workflow = await workflowWithValidDraft(env);
    await expectProblem(publish(env, env.viewer, workflow.id, workflow.revision), 403, 'FORBIDDEN');
  });

  it('422 for a note over 500 characters or an unknown field', async () => {
    const workflow = await workflowWithValidDraft(env);
    await expectProblem(
      publish(env, env.owner, workflow.id, workflow.revision, 'x'.repeat(501)),
      422,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      api(env)
        .post(`${base()}/${workflow.id}/versions`)
        .set(authHeaders(env.owner))
        .set('If-Match', quoted(workflow.revision))
        .send({ other: 1 }),
      422,
      'VALIDATION_FAILED',
    );
  });

  it('parallel publications of the same draft create a single version (R11)', async () => {
    const workflow = await workflowWithValidDraft(env);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        publish(env, index % 2 ? env.owner : env.editor, workflow.id, workflow.revision),
      ),
    );
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await versions(workflow.id)).toHaveLength(1);
  });

  it('refuses to publish a draft identical to the latest version, pointing to activation', async () => {
    const workflow = await workflowWithValidDraft(env);
    await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
    const problem = await expectProblem(
      publish(env, env.owner, workflow.id, workflow.revision),
      409,
      'DRAFT_CONFLICT',
    );
    expect(problem.detail).toContain('versión 1');
  });

  describe('activation', () => {
    it('reactivating an older version creates no version and leaves the draft alone', async () => {
      const workflow = await workflowWithValidDraft(env);
      await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
      const saved = await saveDraft(
        env,
        env.owner,
        workflow.id,
        workflow.revision,
        validDefinition({ padNodes: 1 }),
      ).expect(200);
      const revision = (saved.body as { revision: number }).revision;
      await publish(env, env.owner, workflow.id, revision).expect(201);

      const response = await api(env)
        .post(`${base()}/${workflow.id}/versions/1/activate`)
        .set(authHeaders(env.editor))
        .expect(200);
      expect(VersionSummarySchema.parse(response.body)).toMatchObject({ number: 1, active: true });

      const list = (await versions(workflow.id)) as { number: number; active: boolean }[];
      expect(list.map((item) => [item.number, item.active])).toEqual([
        [2, false],
        [1, true],
      ]);
      const read = await api(env)
        .get(`${base()}/${workflow.id}`)
        .set('Cookie', env.owner.cookie)
        .expect(200);
      const body = WorkflowSchema.parse(read.body);
      expect(body.activeVersionNumber).toBe(1);
      expect(body.draftRevision).toBe(revision);
    });

    it('404 for a version that does not exist; 403 for a viewer', async () => {
      const workflow = await workflowWithValidDraft(env);
      await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
      await expectProblem(
        api(env).post(`${base()}/${workflow.id}/versions/9/activate`).set(authHeaders(env.owner)),
        404,
        'NOT_FOUND',
      );
      await expectProblem(
        api(env).post(`${base()}/${workflow.id}/versions/1/activate`).set(authHeaders(env.viewer)),
        403,
        'FORBIDDEN',
      );
    });

    it('404 for a version of another workflow of the same organization', async () => {
      const first = await workflowWithValidDraft(env);
      const second = await createWorkflow(env);
      await publish(env, env.owner, first.id, first.revision).expect(201);
      await expectProblem(
        api(env).post(`${base()}/${second.id}/versions/1/activate`).set(authHeaders(env.owner)),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('copy a version to the draft', () => {
    it('replaces the draft with the definition of the version and bumps the revision', async () => {
      const workflow = await workflowWithValidDraft(env);
      await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
      const saved = await saveDraft(
        env,
        env.owner,
        workflow.id,
        workflow.revision,
        invalidDefinition(),
      ).expect(200);
      const revision = (saved.body as { revision: number }).revision;

      const response = await api(env)
        .post(`${base()}/${workflow.id}/draft/from-version/1`)
        .set(authHeaders(env.editor))
        .set('If-Match', quoted(revision))
        .expect(200);
      const body = WorkflowSchema.parse(response.body);
      expect(body.draftRevision).toBe(revision + 1);
      expect(response.headers.etag).toBe(quoted(revision + 1));
      expect(body.draft).toEqual((await storedVersion(workflow.id, 1))!.definition);
      expect(body.draftValidation?.valid).toBe(true);
    });

    it('428 without If-Match, 409 on a stale revision, 404 for a missing version', async () => {
      const workflow = await workflowWithValidDraft(env);
      await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
      const url = `${base()}/${workflow.id}/draft/from-version`;
      await expectProblem(
        api(env).post(`${url}/1`).set(authHeaders(env.owner)),
        428,
        'PRECONDITION_REQUIRED',
      );
      await expectProblem(
        api(env).post(`${url}/1`).set(authHeaders(env.owner)).set('If-Match', quoted(1)),
        409,
        'DRAFT_CONFLICT',
      );
      await expectProblem(
        api(env)
          .post(`${url}/9`)
          .set(authHeaders(env.owner))
          .set('If-Match', quoted(workflow.revision)),
        404,
        'NOT_FOUND',
      );
    });

    it('a viewer cannot copy: 403', async () => {
      const workflow = await workflowWithValidDraft(env);
      await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
      await expectProblem(
        api(env)
          .post(`${base()}/${workflow.id}/draft/from-version/1`)
          .set(authHeaders(env.viewer))
          .set('If-Match', quoted(workflow.revision)),
        403,
        'FORBIDDEN',
      );
    });
  });

  it('archiving deactivates the version and keeps the versions rows (FR-017)', async () => {
    const workflow = await workflowWithValidDraft(env);
    await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
    await api(env).delete(`${base()}/${workflow.id}`).set(authHeaders(env.owner)).expect(204);

    const bridge = await env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      (tx) =>
        tx
          .select()
          .from(workflowActiveVersions)
          .where(eq(workflowActiveVersions.workflowId, workflow.id)),
    );
    expect(bridge).toHaveLength(1);
    expect(bridge[0]).toMatchObject({ versionId: null, activatedBy: null, activatedAt: null });
    expect(await storedVersion(workflow.id, 1)).toBeDefined();
    await expectProblem(
      api(env).get(`${base()}/${workflow.id}/versions`).set('Cookie', env.owner.cookie),
      404,
      'NOT_FOUND',
    );
  });

  it('publishes against the current limits of the organization, not those of the save', async () => {
    const { session, organizationId } = await freshOrganization(env);
    const workflow = await createWorkflow(env, session, undefined, organizationId);
    const saved = await saveDraft(
      env,
      session,
      workflow.id,
      1,
      validDefinition({ padNodes: 3 }),
      organizationId,
    ).expect(200);
    await setLimitsAsOperator(organizationId, {
      maxNodes: 3,
      maxEdges: 100,
      maxDefinitionBytes: 262144,
    });
    const problem = await expectProblem(
      publish(
        env,
        session,
        workflow.id,
        (saved.body as { revision: number }).revision,
        undefined,
        organizationId,
      ),
      422,
      'DAG_INVALID',
    );
    expect(problem.dagErrors?.map((error) => error.code)).toContain('LIMIT_NODES');
  });

  it('404 for every version operation from another organization', async () => {
    const workflow = await workflowWithValidDraft(env);
    await publish(env, env.owner, workflow.id, workflow.revision).expect(201);
    const url = `${base()}/${workflow.id}`;
    await expectProblem(
      api(env).get(`${url}/versions`).set('Cookie', env.outsider.cookie),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      api(env).get(`${url}/versions/1`).set('Cookie', env.outsider.cookie),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      api(env).post(`${url}/versions/1/activate`).set(authHeaders(env.outsider)),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      publish(env, env.outsider, workflow.id, workflow.revision),
      404,
      'NOT_FOUND',
    );

    // Through the outsider own organization the workflow does not exist either.
    const own = workflowsPath(env.outsiderOrganization.id);
    await expectProblem(
      api(env).get(`${own}/${workflow.id}/versions`).set('Cookie', env.outsider.cookie),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      publish(
        env,
        env.outsider,
        workflow.id,
        workflow.revision,
        undefined,
        env.outsiderOrganization.id,
      ),
      404,
      'NOT_FOUND',
    );
  });
});
